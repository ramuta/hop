import normalizeEnvVarArray from './utils/normalizeEnvVarArray'
import normalizeEnvVarNumber from './utils/normalizeEnvVarNumber'
import os from 'os'
import path from 'path'
import { Addresses, Bonders, Bridges } from '@hop-protocol/core/addresses'
import { Chain, DefaultBatchBlocks, Network, TotalBlocks } from 'src/constants'
import { Tokens as Metadata } from '@hop-protocol/core/metadata'
import { Networks } from '@hop-protocol/core/networks'
import * as goerliConfig from './goerli'
import * as kovanConfig from './kovan'
import * as mainnetConfig from './mainnet'
import * as stagingConfig from './staging'
import * as testConfig from './test'
require('./loadEnvFile')
const defaultDbPath = path.resolve(__dirname, '../../../db_data')

export const ipfsHost = process.env.IPFS_HOST || 'http://127.0.0.1:5001'
export const hostname = process.env.HOSTNAME || os.hostname()
export const slackChannel = process.env.SLACK_CHANNEL
export const slackWarnChannel = process.env.SLACK_WARN_CHANNEL // optional
export const slackErrorChannel = process.env.SLACK_ERROR_CHANNEL // optional
export const slackInfoChannel = process.env.SLACK_INFO_CHANNEL // optional
export const slackLogChannel = process.env.SLACK_LOG_CHANNEL // optional
export const slackSuccessChannel = process.env.SLACK_SUCCESS_CHANNEL // optional
export const slackAuthToken = process.env.SLACK_AUTH_TOKEN
export const slackUsername = process.env.SLACK_USERNAME || 'Hop Node'
export const gasBoostWarnSlackChannel = process.env.GAS_BOOST_WARN_SLACK_CHANNEL // optional
export const gasBoostErrorSlackChannel = process.env.GAS_BOOST_ERROR_SLACK_CHANNEL // optional
export const enabledSettleWatcherDestinationChains = normalizeEnvVarArray(process.env.ENABLED_SETTLE_WATCHER_DESTINATION_CHAINS)
export const enabledSettleWatcherSourceChains = normalizeEnvVarArray(process.env.ENABLED_SETTLE_WATCHER_SOURCE_CHAINS)
export const gasPriceMultiplier = normalizeEnvVarNumber(process.env.GAS_PRICE_MULTIPLIER)
export const minPriorityFeePerGas = normalizeEnvVarNumber(process.env.MIN_PRIORITY_FEE_PER_GAS)
export const priorityFeePerGasCap = normalizeEnvVarNumber(process.env.PRIORITY_FEE_PER_GAS_CAP)
export const maxGasPriceGwei = normalizeEnvVarNumber(process.env.MAX_GAS_PRICE_GWEI)
export const timeTilBoostMs = normalizeEnvVarNumber(process.env.TIME_TIL_BOOST_MS)
const envNetwork = process.env.NETWORK || Network.Kovan
const isTestMode = !!process.env.TEST_MODE
const bonderPrivateKey = process.env.BONDER_PRIVATE_KEY

export const bondableChains: string[] = [Chain.Optimism, Chain.Arbitrum]
export const rateLimitMaxRetries = 5
export const rpcTimeoutSeconds = 10 * 60
export const defaultConfigDir = `${os.homedir()}/.hop-node`
export const defaultConfigFilePath = `${defaultConfigDir}/config.json`
export const defaultKeystoreFilePath = `${defaultConfigDir}/keystore.json`

type SyncConfig = {
  totalBlocks?: number
  batchBlocks?: number
}
type SyncConfigs = { [key: string]: SyncConfig }
type DbConfig = {
  path: string
}
type Config = {
  isMainnet: boolean
  tokens:Bridges & {[network: string]: any},
  network: string,
  networks: Networks & {[network: string]: any},
  bonderPrivateKey: string,
  metadata: Metadata & {[network: string]: any},
  bonders: Bonders,
  stateUpdateAddress: string,
  db: DbConfig,
  sync: SyncConfigs,
}

const networkConfigs: {[key: string]: any} = {
  test: testConfig,
  kovan: kovanConfig,
  goerli: goerliConfig,
  mainnet: mainnetConfig,
  staging: stagingConfig
}

const normalizeNetwork = (network: string) => {
  if (network === Network.Staging) {
    return Network.Mainnet
  }
  return network
}

const getConfigByNetwork = (network: string):Partial<Config> => {
  const { addresses: tokens, networks, bonders, metadata } = isTestMode ? networkConfigs.test : (networkConfigs as any)?.[network]
  network = normalizeNetwork(network)
  const isMainnet = network === Network.Mainnet

  return {
    network,
    tokens,
    networks,
    bonders,
    metadata,
    isMainnet
  }
}

// get default config
const { tokens, network, networks, metadata, bonders, isMainnet } = getConfigByNetwork(envNetwork)

export const config: Config = {
  isMainnet,
  tokens,
  network,
  networks,
  bonderPrivateKey,
  metadata,
  bonders,
  stateUpdateAddress: '',
  db: {
    path: defaultDbPath
  },
  sync: {
    [Chain.Ethereum]: {
      totalBlocks: TotalBlocks.Ethereum,
      batchBlocks: DefaultBatchBlocks
    },
    [Chain.Arbitrum]: {
      totalBlocks: 100_000,
      batchBlocks: DefaultBatchBlocks
    },
    [Chain.Optimism]: {
      totalBlocks: 100_000,
      batchBlocks: DefaultBatchBlocks
    },
    [Chain.Polygon]: {
      totalBlocks: TotalBlocks.Polygon,
      batchBlocks: DefaultBatchBlocks
    },
    [Chain.xDai]: {
      totalBlocks: TotalBlocks.xDai,
      batchBlocks: DefaultBatchBlocks
    }
  }
}

export const setConfigByNetwork = (network: string) => {
  const { tokens, networks, bonders, metadata, isMainnet } = getConfigByNetwork(network)
  config.isMainnet = isMainnet
  config.tokens = tokens
  config.network = normalizeNetwork(network)
  config.networks = networks
  config.bonders = bonders
  config.metadata = metadata
}

export const setConfigAddresses = (addresses: Addresses) => {
  const { bridges, bonders } = addresses
  config.tokens = bridges
  config.bonders = bonders
}

export const setBonderPrivateKey = (privateKey: string) => {
  config.bonderPrivateKey = privateKey
}

export const setNetworkRpcUrls = (network: string, rpcUrls: string[]) => {
  network = normalizeNetwork(network)
  if (config.networks[network]) {
    config.networks[network].rpcUrls = rpcUrls
  }
}

export const setNetworkWaitConfirmations = (
  network: string,
  waitConfirmations: number
) => {
  if (config.networks[network]) {
    config.networks[network].waitConfirmations = waitConfirmations
  }
}

export const setStateUpdateAddress = (address: string) => {
  config.stateUpdateAddress = address
}

export const setSyncConfig = (syncConfigs: SyncConfigs = {}) => {
  const networks = Object.keys(config.networks)
  for (const network of networks) {
    if (!config.sync[network]) {
      config.sync[network] = {}
    }
    if (syncConfigs[network]?.totalBlocks) {
      config.sync[network].totalBlocks = syncConfigs[network]?.totalBlocks
    }
    if (syncConfigs[network]?.batchBlocks) {
      config.sync[network].batchBlocks = syncConfigs[network]?.batchBlocks
    }
  }
}

export const setDbPath = (dbPath: string) => {
  config.db.path = dbPath
}

export const getEnabledTokens = (): string[] => {
  return Object.keys(config.tokens)
}

export const getEnabledNetworks = (): string[] => {
  const networks: {[network: string]: boolean} = {}
  for (const token in config.tokens) {
    for (const network in config.tokens[token]) {
      networks[network] = true
    }
  }
  return Object.keys(networks)
}

export * from './validation'
export * from './fileOps'
