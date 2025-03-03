import SettleBondedWithdrawalWatcher from 'src/watchers/SettleBondedWithdrawalWatcher'
import {
  FileConfig,
  parseConfigFile,
  setGlobalConfigFromConfigFile
} from 'src/config'
import {
  findWatcher,
  getWatchers
} from 'src/watchers/watchers'
import { logger, program } from './shared'

program
  .command('settle')
  .description('Settle bonded withdrawals')
  .option('--config <string>', 'Config file to use.')
  .option('--env <string>', 'Environment variables file')
  .option('--source-chain <string>', 'Source chain')
  .option('--token <string>', 'Token')
  .option('--transfer-id <string>', 'Transfer ID')
  .option(
    '-d, --dry',
    'Start in dry mode. If enabled, no transactions will be sent.'
  )
  .action(async source => {
    try {
      const configPath = source?.config || source?.parent?.config
      if (configPath) {
        const config: FileConfig = await parseConfigFile(configPath)
        await setGlobalConfigFromConfigFile(config)
      }

      const chain = source.sourceChain
      const token = source.token
      const transferId = source.transferId
      const dryMode = !!source.dry
      if (!chain) {
        throw new Error('chain is required')
      }
      if (!token) {
        throw new Error('token is required')
      }
      if (!transferId) {
        throw new Error('transfer ID is required')
      }

      const watchers = getWatchers({
        enabledWatchers: ['settleBondedWithdrawals'],
        tokens: [token],
        dryMode
      })

      const watcher = findWatcher(watchers, SettleBondedWithdrawalWatcher, chain) as SettleBondedWithdrawalWatcher
      if (!watcher) {
        throw new Error('watcher not found')
      }

      await watcher.checkTransferId(transferId)

      process.exit(0)
    } catch (err) {
      logger.error(err.message)
      process.exit(1)
    }
  })
