import BaseWatcher from './classes/BaseWatcher'
import L1Bridge from 'src/watchers/classes/L1Bridge'
import chalk from 'chalk'
import wait from 'src/utils/wait'
import wallets from 'src/wallets'
import { Chain } from 'src/constants'
import { Contract } from 'ethers'
import { config as globalConfig } from 'src/config'
import { l1xDaiAmbAbi, l2xDaiAmbAbi } from '@hop-protocol/core/abi'
import { solidityKeccak256 } from 'ethers/lib/utils'

type Config = {
  chainSlug: string
  tokenSymbol: string
  label?: string
  l1BridgeContract?: Contract
  bridgeContract?: Contract
  isL1?: boolean
  dryMode?: boolean
}

export const getL1Amb = (token: string) => {
  const l1Wallet = wallets.get(Chain.Ethereum)
  const l1AmbAddress = globalConfig.tokens[token].xdai.l1Amb
  return new Contract(l1AmbAddress, l1xDaiAmbAbi, l1Wallet)
}

export const getL2Amb = (token: string) => {
  const l2xDaiProvider = wallets.get(Chain.xDai).provider
  const l2AmbAddress = globalConfig.tokens[token].xdai.l2Amb
  return new Contract(l2AmbAddress, l2xDaiAmbAbi, l2xDaiProvider)
}

export const executeExitTx = async (event: any, token: string) => {
  const l1Amb = getL1Amb(token)
  const l2Amb = getL2Amb(token)

  const message = event.args.encodedData
  const msgHash = solidityKeccak256(['bytes'], [message])
  const id = await l2Amb.numMessagesSigned(msgHash)
  const alreadyProcessed = await l2Amb.isAlreadyProcessed(id)
  if (!alreadyProcessed) {
    return
  }

  const messageId =
    '0x' +
    Buffer.from(strip0x(message), 'hex')
      .slice(0, 32)
      .toString('hex')
  const alreadyRelayed = await l1Amb.relayedMessages(messageId)
  if (alreadyRelayed) {
    return
  }

  const requiredSigs = (await l2Amb.requiredSignatures()).toNumber()
  const sigs: any[] = []
  for (let i = 0; i < requiredSigs; i++) {
    const sig = await l2Amb.signature(msgHash, i)
    const [v, r, s]: any[] = [[], [], []]
    const vrs = signatureToVRS(sig)
    v.push(vrs.v)
    r.push(vrs.r)
    s.push(vrs.s)
    sigs.push(vrs)
  }
  const packedSigs = packSignatures(sigs)

  const tx = await l1Amb.executeSignatures(message, packedSigs)
  return {
    tx,
    msgHash,
    message,
    packedSigs
  }
}

// reference:
// https://github.com/poanetwork/tokenbridge/blob/bbc68f9fa2c8d4fff5d2c464eb99cea5216b7a0f/oracle/src/events/processAMBCollectedSignatures/index.js#L149
class xDaiBridgeWatcher extends BaseWatcher {
  l1Bridge: L1Bridge

  constructor (config: Config) {
    super({
      chainSlug: config.chainSlug,
      tokenSymbol: config.tokenSymbol,
      tag: 'xDaiBridgeWatcher',
      prefix: config.label,
      logColor: 'yellow',
      bridgeContract: config.bridgeContract,
      isL1: config.isL1,
      dryMode: config.dryMode
    })
    if (config.l1BridgeContract) {
      this.l1Bridge = new L1Bridge(config.l1BridgeContract)
    }
  }

  async start () {
    this.started = true
    try {
      const l1Amb = getL1Amb(this.tokenSymbol)
      const l2Amb = getL2Amb(this.tokenSymbol)

      this.logger.debug(`xDai ${this.tokenSymbol} bridge watcher started`)
      while (true) {
        if (!this.started) {
          return
        }
        const blockNumber = await l2Amb.provider.getBlockNumber()
        const events = await l2Amb?.queryFilter(
          l2Amb.filters.UserRequestForSignature(),
          (blockNumber as number) - 100
        )

        for (const event of events) {
          try {
            const result = await executeExitTx(event, this.tokenSymbol)
            if (!result) {
              continue
            }
            const { tx, msgHash, message, packedSigs } = result
            tx?.wait().then(() => {
              this.emit('executeSignatures', {
                message,
                packedSigs
              })
            })
            this.logger.debug('executeSignatures messageHash:', msgHash)
            this.logger.info(
              'executeSignatures tx hash:',
              chalk.bgYellow.black.bold(tx.hash)
            )
            await tx?.wait()
          } catch (err) {
            this.logger.error('tx error:', err.message)
          }
        }
        await wait(10 * 1000)
      }
    } catch (err) {
      this.logger.error('xDai bridge watcher error:', err)
      this.quit()
    }
  }

  async handleCommitTxHash (commitTxHash: string, transferRootHash: string) {
    const dbTransferRoot = await this.db.transferRoots.getByTransferRootHash(transferRootHash)
    const destinationChainId = dbTransferRoot?.destinationChainId
    const l2Amb = getL2Amb(this.tokenSymbol)
    const tx: any = await this.bridge.getTransaction(commitTxHash)
    const sigEvents = await l2Amb?.queryFilter(
      l2Amb.filters.UserRequestForSignature(),
      tx.blockNumber - 1,
      tx.blockNumber + 1
    )

    for (const sigEvent of sigEvents) {
      const { encodedData } = sigEvent.args
      // TODO: better way of slicing by method id
      const data = /ef6ebe5e00000/.test(encodedData)
        ? encodedData.replace(/.*(ef6ebe5e00000.*)/, '$1')
        : ''
      if (!data) {
        continue
      }
      const {
        rootHash,
        originChainId,
        destinationChain
      } = await this.l1Bridge.decodeConfirmTransferRootData(
        '0x' + data.replace('0x', '')
      )
      this.logger.debug(
          `attempting to send relay message on xdai for commit tx hash ${commitTxHash}`
      )
      await this.handleStateSwitch()
      if (this.isDryOrPauseMode) {
        this.logger.warn(`dry: ${this.dryMode}, pause: ${this.pauseMode}. skipping executeExitTx`)
        return
      }
      const result = await executeExitTx(sigEvent, this.tokenSymbol)
      if (result) {
        await this.db.transferRoots.update(transferRootHash, {
          sentConfirmTxAt: Date.now()
        })
        const { tx } = result
        tx?.wait()
          .then(async (receipt: any) => {
            if (receipt.status !== 1) {
              await this.db.transferRoots.update(transferRootHash, {
                sentConfirmTxAt: 0
              })
              throw new Error('status=0')
            }

            if (destinationChainId) {
              this.emit('transferRootConfirmed', {
                transferRootHash,
                destinationChainId
              })
            }
          })
          .catch(async (err: Error) => {
            this.db.transferRoots.update(transferRootHash, {
              sentConfirmTxAt: 0
            })

            throw err
          })
        this.logger.info('transferRootHash:', transferRootHash)
        this.logger.info(
            `sent chainId ${this.bridge.chainId} confirmTransferRoot L1 exit tx`,
            chalk.bgYellow.black.bold(tx.hash)
        )
        this.notifier.info(
            `chainId: ${this.bridge.chainId} confirmTransferRoot L1 exit tx: ${tx.hash}`
        )
      }
    }
  }
}

export default xDaiBridgeWatcher

// https://github.com/poanetwork/tokenbridge/blob/bbc68f9fa2c8d4fff5d2c464eb99cea5216b7a0f/oracle/src/utils/message.js
const assert = require('assert')
const { toHex, numberToHex, padLeft } = require('web3-utils')

export const strip0x = (value: string) => value.replace(/^0x/gi, '')

export function createMessage ({
  recipient,
  value,
  transactionHash,
  bridgeAddress,
  expectedMessageLength
}: any) {
  recipient = strip0x(recipient)
  assert.strictEqual(recipient.length, 20 * 2)

  value = numberToHex(value)
  value = padLeft(value, 32 * 2)

  value = strip0x(value)
  assert.strictEqual(value.length, 64)

  transactionHash = strip0x(transactionHash)
  assert.strictEqual(transactionHash.length, 32 * 2)

  bridgeAddress = strip0x(bridgeAddress)
  assert.strictEqual(bridgeAddress.length, 20 * 2)

  const message = `0x${recipient}${value}${transactionHash}${bridgeAddress}`
  assert.strictEqual(message.length, 2 + 2 * expectedMessageLength)
  return message
}

export function parseMessage (message: any) {
  message = strip0x(message)

  const recipientStart = 0
  const recipientLength = 40
  const recipient = `0x${message.slice(
    recipientStart,
    recipientStart + recipientLength
  )}`

  const amountStart = recipientStart + recipientLength
  const amountLength = 32 * 2
  const amount = `0x${message.slice(amountStart, amountStart + amountLength)}`

  const txHashStart = amountStart + amountLength
  const txHashLength = 32 * 2
  const txHash = `0x${message.slice(txHashStart, txHashStart + txHashLength)}`

  const contractAddressStart = txHashStart + txHashLength
  const contractAddressLength = 32 * 2
  const contractAddress = `0x${message.slice(
    contractAddressStart,
    contractAddressStart + contractAddressLength
  )}`

  return {
    recipient,
    amount,
    txHash,
    contractAddress
  }
}

export function signatureToVRS (rawSignature: any) {
  const signature = strip0x(rawSignature)
  assert.strictEqual(signature.length, 2 + 32 * 2 + 32 * 2)
  const v = signature.substr(64 * 2)
  const r = signature.substr(0, 32 * 2)
  const s = signature.substr(32 * 2, 32 * 2)
  return { v, r, s }
}

export function packSignatures (array: any[]) {
  const length = strip0x(toHex(array.length))
  const msgLength = length.length === 1 ? `0${length}` : length
  let v = ''
  let r = ''
  let s = ''
  array.forEach(e => {
    v = v.concat(e.v)
    r = r.concat(e.r)
    s = s.concat(e.s)
  })
  return `0x${msgLength}${v}${r}${s}`
}

export function parseAMBHeader (message: any) {
  message = strip0x(message)

  const messageIdStart = 0
  const messageIdLength = 32 * 2
  const messageId = `0x${message.slice(
    messageIdStart,
    messageIdStart + messageIdLength
  )}`

  const senderStart = messageIdStart + messageIdLength
  const senderLength = 20 * 2
  const sender = `0x${message.slice(senderStart, senderStart + senderLength)}`

  const executorStart = senderStart + senderLength
  const executorLength = 20 * 2
  const executor = `0x${message.slice(
    executorStart,
    executorStart + executorLength
  )}`

  const gasLimitStart = executorStart + executorLength
  const gasLimitLength = 4 * 2
  const gasLimit = parseInt(
    message.slice(gasLimitStart, gasLimitStart + gasLimitLength),
    16
  )

  return {
    messageId,
    sender,
    executor,
    gasLimit
  }
}
