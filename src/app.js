const express = require('express')
const morgan = require('morgan')
const bodyParser = require('body-parser')
const Task = require('./task.js')
const redis = require('./redis.js')
const DB_NS_TASKS = 'tasks'
let redisClient, nextTask, nextSchedule

function parseKey (fullKey) {
  const parts = fullKey.split(':')
  return { fullKey, key: `${parts[1]}:${parts[2]}`, time: +parts[1] }
}

async function run () {
  console.log('Started')

  setUpDB()
  setUpExpress()
}

function setUpDB () {
  redisClient = redis.createClient()
  const subClient = redis.createClient()
  // Re-schedule task on any tasks list change.
  subClient.psubscribe(`__keyspace@*__:${DB_NS_TASKS}:*`)
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
  for (let i = 0; i < 3; i++) {
    const res = await redisClient.setnx(`${DB_NS_TASKS}:${task.key}`,
      task.message)
    if (res) {
      console.log(`Enqueued a task at ${task.time}`)
      return
    }
    task.changeKey()
  }
  throw new Error(`Can't add a task after 3 tries, last key: ${task.key}`)
}

async function getNextTask () {
  unscheduleExec()
  nextTask = null
  let earliest
  const keys = await redisClient.keys(`${DB_NS_TASKS}:*`)
  if (!keys.length) {
    console.log('No tasks to watch for')
    return
  }
  keys.forEach(fullKey => {
    const key = parseKey(fullKey)
    if (!earliest || key.time < earliest.time) {
      earliest = key
    }
  })
  const message = await redisClient.get(earliest.fullKey)
  // Probably it was already removed by another instance.
  if (!message) {
    console.log('No tasks to watch for, last removed')
    return
  }
  nextTask = new Task(earliest.time, message, earliest.key)
  scheduleExec(new Date(earliest.time))
  console.log(`Watching for task ${earliest.key}`)
}

async function execTask () {
  console.log('Exec task')
  const res = await redisClient.del(`${DB_NS_TASKS}:${nextTask.key}`)
  if (!res) {
    console.log('Already executed')
    return
  }
  // I assume it's nearly impossible that process will die between successful
  // task removal and print, so we can get rid of WATCH and MULTI.
  console.log(nextTask.message)
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
