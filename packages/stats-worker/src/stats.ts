import { Hop } from '@hop-protocol/sdk'
import wait from 'wait'
import { mainnet as mainnetAddresses } from '@hop-protocol/core/addresses'

const sdk = new Hop('mainnet')

type PoolData = {
  apr: number
}

type Data = { [token: string]: { [chain: string]: PoolData } }

type Response = {
  timestamp: number
  data: Data
}

class Stats {
  async getAllAprs () {
    const timestamp = (Date.now() / 1000) | 0
    const data: Data = {}
    const bridges = mainnetAddresses.bridges
    const promises: Promise<any>[] = []
    for (let token in bridges) {
      for (let chain in bridges[token]) {
        if (chain === 'ethereum') {
          continue
        }
        if (!data[token]) {
          data[token] = {}
        }
        if (!data[token][chain]) {
          data[token][chain] = {
            apr: 0
          }
        }
        promises.push(
          this.getApr(token, chain)
            .then(apr => {
              data[token][chain].apr = apr
            })
            .catch(err => console.error(err))
        )
      }
    }

    await Promise.all(promises)
    const response: Response = {
      timestamp,
      data
    }

    return response
  }

  async getApr (token: string, chain: string) {
    const bridge = sdk.bridge(token)
    const amm = bridge.getAmm(chain)
    const apr = await amm.getApr()
    return apr
  }
}

export default Stats
