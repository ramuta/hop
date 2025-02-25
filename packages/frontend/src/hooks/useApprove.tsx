import React from 'react'
import { BigNumber } from 'ethers'
import { useWeb3Context } from 'src/contexts/Web3Context'
import { useApp } from 'src/contexts/AppContext'
import { Token, Chain } from '@hop-protocol/sdk'
import Transaction from 'src/models/Transaction'
import { toTokenDisplay } from 'src/utils'
import { UINT256 } from 'src/constants'

const useApprove = () => {
  const { provider } = useWeb3Context()
  const {
    txConfirm,
    txHistory,
    sdk,
  } = useApp()

  const checkApproval = async (
    amount: BigNumber,
    token: Token,
    spender: string
  ) => {
    try {
      const signer = provider?.getSigner()
      if (!signer) {
        throw new Error('Wallet not connected')
      }

      if (token.isNativeToken) {
        return false
      }

      const approved = await token.allowance(spender)
      if (approved.gte(amount)) {
        return false
      }

      return true
    } catch (err: any) {
      return false
    }
  }

  const approve = async (
    amount: BigNumber,
    token: Token,
    spender: string
  ) => {
    const signer = provider?.getSigner()
    if (!signer) {
      throw new Error('Wallet not connected')
    }

    if (token.isNativeToken) {
      return
    }

    const approved = await token.allowance(spender)
    if (approved.gte(amount)) {
      return
    }

    const formattedAmount = toTokenDisplay(amount, token.decimals)
    const chain = Chain.fromSlug(token.chain.slug)
    const tx = await txConfirm?.show({
      kind: 'approval',
      inputProps: {
        tagline: `Allow Hop to spend your ${token.symbol} on ${chain.name}`,
        amount: token.symbol === 'USDT' ? undefined : formattedAmount,
        token: token.symbol
      },
      onConfirm: async (approveAll: boolean) => {
        const approveAmount = approveAll ? UINT256 : amount
        return token.approve(
          spender,
          approveAmount
        )
      }
    })

    if (tx?.hash) {
      txHistory?.addTransaction(
        new Transaction({
          hash: tx?.hash,
          networkName: token.chain.slug,
          token
        })
      )
    }

    return tx
  }

  return { approve, checkApproval }
}

export default useApprove
