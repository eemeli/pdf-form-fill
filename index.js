const spawn = require('child_process').spawn
const fs = require('fs')
const tmp = require('tmp')
const XFDF = require('xfdf')


/** Display the available fields of a PDF form
 *
 * @param {string} pdf - path for the source PDF file
 * @returns {Promise(Object)} provides the map of field names to their attributes and values
 */
function fields (pdf) {
  return new Promise((resolve, reject) => {
    fs.access(pdf, fs.constants.R_OK, (err) => {
      if (err) return reject(err)
      const { stderr, stdout } = spawn('pdftk', [pdf, 'dump_data_fields_utf8'])
      let output = ''
      stderr.on('data', (err) => reject(new Error(err.toString())))
      stdout.on('data', (chunk) => { output += chunk })
      stdout.on('end', () => {
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
  })
}


const pdfDate = (date) => {
  if (!date) return ''
  if (typeof date === 'string') return date
  return 'D:' + date.toISOString().replace(/[-:T]/g, '').replace(/\..*/, "Z00'00'")
}

const pdfInfo = (info) => {
  if (info.ModDate) info.ModDate = pdfDate(info.ModDate)
  if (info.CreationDate) info.CreationDate = pdfDate(info.CreationDate)
  return Object.keys(info).reduce((str, key) => (
    str + `InfoBegin\nInfoKey: ${key}\nInfoValue: ${info[key] || ''}\n`
  ), '')
}

const setInfo = (pdf, info, reject) => {
  const { stdin, stdout, stderr } = spawn('pdftk', [pdf, 'update_info_utf8', '-', 'output', '-'])
  stderr.on('data', reject)
  stdin.write(pdfInfo(info), 'utf8', () => stdin.end())
  return stdout
}

const fillForm = (input, xfdf, flatten, reject, resolve) => {
  const args = ['-', 'fill_form', xfdf, 'output', '-']
  if (flatten) args.push('flatten')
  const { stdin, stdout, stderr } = spawn('pdftk', args, { stdio: [input] })
  input.destroy()  // https://github.com/nodejs/node/issues/9413#issuecomment-258604006
  const listener = (data) => {
    stdout.pause()
    stdout.unshift(data)
    stdout.removeListener('data', listener)
    resolve(stdout)
  }
  stderr.on('data', reject)
  stdout.on('data', listener)
}


/** Fill a PDF form with data
 *
 * @param {string} pdf - path for the source PDF file
 * @param {Object} fields - a flat map of data to populate the form's fields
 * @param {Object} [options] - optionally customise the output
 * @param {boolean} [options.flatten=true] - Flatten the resulting PDF
 * @param {Object} [options.info] - info fields to be set in the output
 * @returns {Promise(stream.Readable)} provides the output PDF
 *
 * @example
 * const fs = require('fs')
 * const srcPdf = '...'
 * const tgtPdf = '...'
 * const data = { name1: 'Value 1', checkbox2: 'Yes' }
 *
 * const output = fs.createWriteStream(tgtPdf)
 * fill(scrPdf, data)
 *   .then(stream => stream.pipe(output))
 *   .catch(err => console.error(err))
 */
function fill (pdf, fields, options = {}) {
  const { flatten = true, info } = options
  const xfdfBuilder = new XFDF({ pdf })
  xfdfBuilder.fromJSON({ fields })
  return new Promise((resolve, reject) => {
    const _reject = (err) => {
      if (!(err instanceof Error)) err = new Error(err.toString())
      reject(err)
    }
    fs.access(pdf, fs.constants.R_OK, (err) => {
      if (err) return _reject(err)
      tmp.file((err, xfdf, fd) => {
        if (err) return _reject(err)
        fs.write(fd, xfdfBuilder.generate(), (err, written) => {
          if (err) return _reject(err)
          if (written === 0) return _reject('xfdf wrote 0 bytes!')
          const stream = setInfo(pdf, info, _reject)
          fillForm(stream, xfdf, flatten, _reject, resolve)
        })
      })
    })
  })
}


module.exports = { fields, fill }
