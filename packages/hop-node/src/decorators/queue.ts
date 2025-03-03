import Logger from 'src/logger'
import promiseTimeout from 'src/utils/promiseTimeout'
import wait from 'src/utils/wait'
import { Mutex } from 'async-mutex'
import { Notifier } from 'src/notifier'
import { hostname } from 'src/config'

const mutexes: { [key: string]: Mutex } = {}
const MAX_RETRIES = 1
const TIMEOUT_MS = 300 * 1000

const logger = new Logger('queue')
const notifier = new Notifier(`queue, host: ${hostname}`)

export default function queue (
  target: Object,
  propertyKey: string,
  descriptor: PropertyDescriptor
): any {
  const originalMethod = descriptor.value
  descriptor.value = async function (...args: any[]) {
    let queueGroup = ''
    if (typeof this.getQueueGroup === 'function') {
      queueGroup = await this.getQueueGroup()
    }
    if (!queueGroup) {
      logger.warn('queue group not set')
    }
    if (!mutexes[queueGroup]) {
      mutexes[queueGroup] = new Mutex()
    }
    const mutex = mutexes[queueGroup]
    return mutex.runExclusive(async () => {
      return await queueFn(originalMethod.bind(this))(...args)
    })
  }

  return descriptor
}

export function queueFn (fn: any): any {
  return async (...args: any[]) => {
    let retries = 0
    const retry = () => promiseTimeout(fn(...args), TIMEOUT_MS)
    while (true) {
      try {
        // the await here is intentional to catch any error below
        const result = await retry()
        return result
      } catch (err) {
        retries++
        if (retries >= MAX_RETRIES) {
          notifier.error(`queue function error: ${err.message}`)
          throw err
        }
        logger.error('error:', err.message)
        logger.error(`queue function error; retrying (${retries})`)
        await wait(1 * 1000)
      }
    }
  }
}
