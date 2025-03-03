import BaseDb from './BaseDb'
import chainIdToSlug from 'src/utils/chainIdToSlug'
import { BigNumber } from 'ethers'
import { Chain, RootSetSettleDelayMs, TxRetryDelayMs } from 'src/constants'
import { normalizeDbItem } from './utils'

export type TransferRoot = {
  destinationBridgeAddress?: string
  transferRootId?: string
  transferRootHash?: string
  totalAmount?: BigNumber
  destinationChainId?: number
  sourceChainId?: number
  sentCommitTxAt: number
  committed?: boolean
  committedAt?: number
  commitTxHash?: string
  commitTxBlockNumber?: number
  confirmed?: boolean
  confirmedAt?: number
  confirmTxHash?: string
  rootSetTxHash?: string
  rootSetTimestamp?: number
  sentConfirmTxAt?: number
  shouldBondTransferRoot?: boolean
  bonded?: boolean
  sentBondTxAt?: number
  bondTxHash?: string
  bondedAt?: number
  transferIds?: string[]
  bonder?: string
  withdrawalBondSettleTxSentAt?: number
  bondTotalAmount?: BigNumber
  bondTransferRootId?: string
  challenged?: boolean
  challengeExpired?: boolean
  allSettled?: boolean
}

class TransferRootsDb extends BaseDb {
  async update (transferRootHash: string, data: Partial<TransferRoot>) {
    return super.update(transferRootHash, data)
  }

  async getByTransferRootHash (
    transferRootHash: string
  ): Promise<TransferRoot> {
    const item = (await this.getById(transferRootHash)) as TransferRoot
    if (!item) {
      return item
    }
    if (!item?.transferRootHash) {
      item.transferRootHash = transferRootHash
    }
    return normalizeDbItem(item)
  }

  async getByTransferRootId (transferRootId: string): Promise<TransferRoot> {
    const transferRootHashes = await this.getTransferRootHashes()
    const filtered = (
      await Promise.all(
        transferRootHashes.map(async (transferRootHash: string) => {
          const item = await this.getByTransferRootHash(transferRootHash)
          if (item.transferRootId === transferRootId) {
            return item
          }
        })
      )
    ).filter(x => x)
    return filtered?.[0]
  }

  async getTransferRootHashes (): Promise<string[]> {
    return this.getKeys()
  }

  async getTransferRoots (): Promise<TransferRoot[]> {
    const transferRootHashes = await this.getTransferRootHashes()
    const transferRoots = await Promise.all(
      transferRootHashes.map(transferRootHash => {
        return this.getByTransferRootHash(transferRootHash)
      })
    )

    return transferRoots
      .sort((a, b) => a?.committedAt - b?.committedAt)
      .filter(x => x)
  }

  async getUncommittedBondedTransferRoots (
    filter: Partial<TransferRoot> = {}
  ): Promise<TransferRoot[]> {
    const transferRoots: TransferRoot[] = await this.getTransferRoots()
    return transferRoots.filter(item => {
      return !item.committed && item?.transferIds?.length
    })
  }

  async getUnbondedTransferRoots (
    filter: Partial<TransferRoot> = {}
  ): Promise<TransferRoot[]> {
    const transferRoots: TransferRoot[] = await this.getTransferRoots()
    return transferRoots.filter(item => {
      let timestampOk = true
      if (item?.sentBondTxAt) {
        timestampOk =
          item?.sentBondTxAt + TxRetryDelayMs < Date.now()
      }

      return (
        !item.bonded &&
        !item.confirmed &&
        item.transferRootHash &&
        item.committedAt &&
        item.commitTxHash &&
        item.commitTxBlockNumber &&
        item.destinationChainId &&
        item.sourceChainId &&
        item.shouldBondTransferRoot &&
        timestampOk
      )
    })
  }

  async getUnconfirmedTransferRoots (
    filter: Partial<TransferRoot> = {}
  ): Promise<TransferRoot[]> {
    const transferRoots: TransferRoot[] = await this.getTransferRoots()
    return transferRoots.filter(item => {
      if (filter?.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      if (!item.sourceChainId) {
        return false
      }

      let timestampOk = true
      if (item?.sentConfirmTxAt) {
        timestampOk =
          item?.sentConfirmTxAt + TxRetryDelayMs < Date.now()
      }

      return (
        item.commitTxHash &&
        !item.confirmed &&
        item.transferRootHash &&
        item.destinationChainId &&
        item.committed &&
        item.committedAt &&
        timestampOk
      )
    })
  }

  async getChallengeableTransferRoots (
    filter: Partial<TransferRoot> = {}
  ): Promise<TransferRoot[]> {
    const transferRoots: TransferRoot[] = await this.getTransferRoots()
    return transferRoots.filter(item => {
      // Do not check if a rootHash has been committed. A rootHash can be committed and bonded,
      // but if the bond uses a different totalAmount then it is fraudulent. Instead, use the
      // transferRootId. If transferRootIds do not match then we know the bond is fraudulent.
      const isTransferRootIdValid = item.bondTransferRootId === item.transferRootId
      return (
        item.transferRootHash &&
        item.bonded &&
        !isTransferRootIdValid &&
        !item.challenged &&
        !item.challengeExpired
      )
    })
  }

  async getUnsettledTransferRoots (
    filter: Partial<TransferRoot> = {}
  ): Promise<TransferRoot[]> {
    const transferRoots: TransferRoot[] = await this.getTransferRoots()
    return transferRoots.filter(item => {
      if (filter?.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      // https://github.com/hop-protocol/hop/pull/140#discussion_r697919256
      let rootSetTimestampOk = true
      const checkRootSetTimestamp = item?.rootSetTimestamp && filter?.destinationChainId && chainIdToSlug(filter?.destinationChainId) === Chain.xDai
      if (checkRootSetTimestamp) {
        rootSetTimestampOk = (item.rootSetTimestamp * 1000) + RootSetSettleDelayMs < Date.now()
      }

      let bondSettleTimestampOk = true
      if (item?.withdrawalBondSettleTxSentAt) {
        bondSettleTimestampOk =
          (item?.withdrawalBondSettleTxSentAt + TxRetryDelayMs) <
          Date.now()
      }

      return (
        item.transferRootHash &&
        item.transferIds &&
        item.destinationChainId &&
        item.totalAmount &&
        item.rootSetTxHash &&
        item.committed &&
        item.committedAt &&
        !item.allSettled &&
        rootSetTimestampOk &&
        bondSettleTimestampOk
      )
    })
  }
}

export default TransferRootsDb
