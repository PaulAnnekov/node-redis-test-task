#  Node + Redis test task

Test task built using Node.js + Redis which echoes a message at a given time.

## Usage

- clone
- cp .env.example .env
- set some password in .env
- run `docker-compose up`
- `curl -d "time=<unix timestamp in ms in the future>&message=test" -X POST http://localhost:8080/echoAtTime`
- check output of docker-compose for "test" printed at the time specified
