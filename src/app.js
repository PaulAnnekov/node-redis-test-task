// Explanation:
// We store each task (=request) as
//   times => sorted set([unix time] [unix time]:[random string], ...)
//   tasks:[unix time]:[random string] => message
// On init and on each change in times:* namespace we are getting a task with
// the lowest score (earliest) and schedule its execution.
// On execution we are trying to delete it and if delete was successful we
// print a task message. If it wasn't then it means other process handled task
// first.

const express = require('express')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const Task = require('./task.js')
const asyncRedis = require('async-redis')
const { promisify } = require('util')
const DB_NS_TASKS = 'tasks'
const DB_NS_TIMES = 'times'
let redisClient, nextTask, nextSchedule

function createClient () {
  return asyncRedis.createClient(process.env.REDIS_URL)
}

async function run () {
  console.log('Started')

  setUpDB()
  setUpExpress()
}

function setUpDB () {
  redisClient = createClient()
  const subClient = createClient()
  // Re-schedule task on any times list change.
  subClient.psubscribe(`__keyspace@*__:${DB_NS_TIMES}`)
  subClient.on('pmessage', (pattern, channel, message) => {
    console.debug(`Tasks list changed. ${channel}: ${message}`)
    getNextTask()
  })
  getNextTask()
}

function setUpExpress () {
  const app = express()
  app.use(bodyParser.urlencoded({ extended: true }))
  app.use(morgan('combined'))
  app.post('/echoAtTime', onRequest)
  app.listen(8080, () => console.log('Listening on port 8080'))
}

async function onRequest (req, res) {
  let task
  try {
    task = Task.fromAPI(req.body)
  } catch (e) {
    return res.status(400).send(e.message)
  }
  try {
    await addTask(task)
  } catch (e) {
    console.error('Error when trying to add a task', e)
    return res.status(500).send('Temporary error, retry')
  }
  res.status(200).send('Queued')
}

async function addTask (task) {
  const multi = redisClient.multi()
  const exec = promisify(multi.exec.bind(multi))
  multi.zadd(`${DB_NS_TIMES}`, 'NX', task.time, task.key)
  multi.setnx(`${DB_NS_TASKS}:${task.key}`, task.message)
  const res = await exec()
  if (!res[0]) {
    throw new Error(`Can't add a task with key: ${task.key}`)
  }
}

async function getNextTask () {
  unscheduleExec()
  nextTask = null
  const keys = await redisClient.zrangebyscore(`${DB_NS_TIMES}`, '-inf',
    '+inf', 'withscores', 'limit', 0, 1)
  if (!keys.length) {
    console.log('No tasks to watch for')
    return
  }
  const key = keys[0]
  const message = await redisClient.get(`${DB_NS_TASKS}:${key}`)
  // Probably it was already removed by another instance.
  if (!message) {
    console.log('No tasks to watch for, last removed')
    return
  }
  const time = +key.split(':')[0]
  nextTask = new Task(time, message, key)
  scheduleExec(new Date(time))
  console.log(`Watching for task ${key}`)
}

async function execTask () {
  console.log('Exec task')
  const message = nextTask.message
  const multi = redisClient.multi()
  const exec = promisify(multi.exec.bind(multi))
  multi.zrem(`${DB_NS_TIMES}`, nextTask.key)
  multi.del(`${DB_NS_TASKS}:${nextTask.key}`)
  const res = await exec()
  if (!res[0]) {
    console.log('Already executed')
    return
  }
  // I assume it's nearly impossible that process will die between
  // successful task removal and print.
  console.log(message)
}

function unscheduleExec () {
  clearTimeout(nextSchedule)
}

function scheduleExec (date) {
  nextSchedule = setTimeout(async () => {
    execTask()
  }, date - new Date())
}

run()
