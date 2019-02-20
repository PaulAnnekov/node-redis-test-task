class Task {
  constructor (time, message, key) {
    this.time = time
    this.message = message
    if (key) {
      this.key = key
    } else {
      this.changeKey()
    }
  }

  static fromAPI (data) {
    const date = new Date(+data.time)
    if (isNaN(date) || date < new Date()) {
      throw new Error('Date is invalid or in the past')
    }
    if (!data.message) {
      throw new Error('No message provided')
    }
    return new Task(+data.time, data.message)
  }

  changeKey () {
    this.key = `${this.time}:${Math.random()}`
  }
}

module.exports = Task
