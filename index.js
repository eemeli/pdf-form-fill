const spawn = require('child_process').spawn
const fs = require('fs')
const tmp = require('tmp')
const xfdf = require('xfdf')

function fields (pdf) {
  return new Promise((resolve, reject) => {
    const pdftk = spawn('pdftk', [pdf, 'dump_data_fields_utf8'])
    pdftk.on('error', reject)
    let output = ''
    pdftk.stdout.on('data', (chunk) => { output += chunk })
    pdftk.stdout.on('end', () => {
      const result = {}
      output.split('---').forEach(field => {
        const data = {}
        const re = /^Field([a-z]+): (.*)/gim
        let match
        while ((match = re.exec(field)) !== null) {
          const [_, key, value] = match
          switch (key) {
            case 'Name':
              result[value] = data
              break
            case 'StateOption':
              if (!data.options) data.options = [value]
              else data.options.push(value)
              break
            default:
              data[key.toLowerCase()] = value
          }
        }
      })
      resolve(result)
    })
  })
}

function fill (pdf, fields, options = {}) {
  const { flatten = true } = options
  const xfdfBuilder = new xfdf({ pdf })
  xfdfBuilder.fromJSON({ fields })
  return new Promise((resolve, reject) => {
    tmp.file((err, path, fd) => {
      if (err) return reject(err)
      fs.write(fd, xfdfBuilder.generate(), (err, written) => {
        if (err) return reject(err)
        if (written === 0) return reject(new Error('xfdf wrote 0 bytes!'))
        const args = [pdf, 'fill_form', path, 'output', '-']
        if (flatten) args.push('flatten')
        const { stderr, stdout } = spawn('pdftk', args)
        const listener = (data) => {
          stdout.pause()
          stdout.unshift(data)
          resolve(stdout)
          stdout.removeListener('data', listener)
        }
        stderr.on('data', reject)
        stdout.on('data', listener)
      })
    })
  })
}


module.exports = { fields, fill }
