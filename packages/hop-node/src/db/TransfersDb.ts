import BaseDb from './BaseDb'
import chainIdToSlug from 'src/utils/chainIdToSlug'
import { BigNumber } from 'ethers'
import { OneWeekMs, TxError, TxRetryDelayMs } from 'src/constants'
import { normalizeDbItem } from './utils'

export type Transfer = {
  transferRootId?: string
  transferRootHash?: string
  transferId?: string
  destinationChainId?: number
  destinationChainSlug?: string
  sourceChainId?: number
  sourceChainSlug?: string
  withdrawalBondSettled?: boolean
  withdrawalBonded?: boolean
  withdrawalBonder?: string
  withdrawalBondedTxHash?: string
  withdrawalBondTxError?: TxError
  withdrawalBondBackoffIndex?: number
  bondWithdrawalAttemptedAt?: number

  recipient?: string
  amount?: BigNumber
  amountOutMin?: BigNumber
  bonderFee?: BigNumber
  transferNonce?: string
  deadline?: number
  transferSentTxHash?: string
  transferSentBlockNumber?: number
  transferSentIndex?: number

  isBondable?: boolean
  committed: boolean
}

class TransfersDb extends BaseDb {
  async update (transferId: string, data: Partial<Transfer>) {
    return super.update(transferId, data)
  }

  async getByTransferId (transferId: string): Promise<Transfer> {
    const item = (await this.getById(transferId)) as Transfer
    if (!item) {
      return item
    }
    if (!item.transferId) {
      item.transferId = transferId
    }
    if (item?.destinationChainId) {
      item.destinationChainSlug = chainIdToSlug(item?.destinationChainId)
    }
    if (item?.sourceChainId) {
      item.sourceChainSlug = chainIdToSlug(item.sourceChainId)
    }
    return normalizeDbItem(item)
  }

  async getTransferIds (): Promise<string[]> {
    return this.getKeys()
  }

  async getTransfers (): Promise<Transfer[]> {
    const transferIds = await this.getTransferIds()
    const transfers = await Promise.all(
      transferIds.map(transferId => {
        return this.getByTransferId(transferId)
      })
    )

    // https://stackoverflow.com/a/9175783/1439168
    return transfers
      .filter(x => x)
      .sort((a, b) => {
        if (a.transferSentBlockNumber > b.transferSentBlockNumber) return 1
        if (a.transferSentBlockNumber < b.transferSentBlockNumber) return -1
        if (a.transferSentIndex > b.transferSentIndex) return 1
        if (a.transferSentIndex < b.transferSentIndex) return -1
        return 0
      })
  }

  async getUncommittedTransfers (
    filter: Partial<Transfer> = {}
  ): Promise<Transfer[]> {
    const transfers: Transfer[] = await this.getTransfers()
    return transfers.filter(item => {
      if (filter?.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      return (
        item.transferId &&
        !item.transferRootId &&
        item.transferSentTxHash &&
        !item.committed
      )
    })
  }

  async getUnbondedSentTransfers (
    filter: Partial<Transfer> = {}
  ): Promise<Transfer[]> {
    const transfers: Transfer[] = await this.getTransfers()
    return transfers.filter(item => {
      if (filter?.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      const customTransferIds: string [] = [
        '0xa66b7633f73c4e056e67c92b5632f6c6fbf3527d55dba5a1ee6613e2fbf4178a'
      ]
      if (customTransferIds.includes(item.transferId)) {
        item.isBondable = true
      }

      const invalidTransferIds: string[] = [
        '0xb9332b783982344a6b082ef76ec88f3c567f843dad9c896e43dc3248ca205915',
        '0x53e43773a6942eb91b3439b9bbfc1cbc6c3f4bcd23db92a85ec190e283c7ac4a'
      ]
      if (invalidTransferIds.includes(item.transferId)) {
        return false
      }

      let timestampOk = true
      if (item.bondWithdrawalAttemptedAt) {
        const checkBackoff = [TxError.BonderFeeTooLow, TxError.NotEnoughLiquidity].includes(item.withdrawalBondTxError)
        if (checkBackoff) {
          const delay = TxRetryDelayMs + ((1 << item.withdrawalBondBackoffIndex) * 60 * 1000)
          // TODO: use `sentTransferTimestamp` once it's added to db

          // don't attempt to bond withdrawals after a week
          if (delay > OneWeekMs) {
            return false
          }
          timestampOk = item.bondWithdrawalAttemptedAt + delay < Date.now()
        } else {
          timestampOk = item.bondWithdrawalAttemptedAt + TxRetryDelayMs < Date.now()
        }
      }

      return (
        item.transferId &&
        !item.withdrawalBonded &&
        item.transferSentTxHash &&
        item.isBondable &&
        timestampOk
      )
    })
  }

  async getBondedTransfersWithoutRoots (
    filter: Partial<Transfer> = {}
  ): Promise<Transfer[]> {
    const transfers: Transfer[] = await this.getTransfers()
    return transfers.filter(item => {
      if (filter?.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      return item.withdrawalBonded && !item.transferRootHash
    })
  }
}

export default TransfersDb
