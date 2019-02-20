const redis = require('redis')
const { promisify } = require('util')

class Client {
  constructor () {
    this.client = redis.createClient(process.env.REDIS_URL)
  }

  _promisify (method, ...args) {
    return promisify(this.client[method]).bind(this.client)(...args)
  }

  on (...args) {
    this.client.on(...args)
  }

  psubscribe (...args) {
    this.client.psubscribe(...args)
  }

  setnx (...args) {
    return this._promisify('setnx', ...args)
  }

  keys (...args) {
    return this._promisify('keys', ...args)
  }

  get (...args) {
    return this._promisify('get', ...args)
  }

  del (...args) {
    return this._promisify('del', ...args)
  }
}

exports.createClient = () => new Client()
