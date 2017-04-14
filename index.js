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

const setInfo = (pdf, info, verbose, label) => new Promise((resolve, reject) => {
  tmp.file((err, path, fd) => {
    if (err) return reject(err)
    const { stdin, stdout, stderr } = spawn('pdftk', [pdf, 'update_info_utf8', '-', 'output', path])
    stderr.on('data', reject)
    stdout.on('end', () => resolve(path))
    stdin.write(pdfInfo(info), 'utf8', () => stdin.end())
  })
})

const fillForm = (pdf, xfdf, flatten) => new Promise((resolve, reject) => {
  const args = [pdf, 'fill_form', xfdf, 'output', '-']
  if (flatten) args.push('flatten')
  const { stdout, stderr } = spawn('pdftk', args)
  stderr.on('data', reject)
  stdout.on('readable', () => resolve(stdout))
})


/** Fill a PDF form with data
 *
 * @param {string} pdf - path for the source PDF file
 * @param {Object} fields - a flat map of data to populate the form's fields
 * @param {Object} [options] - optionally customise the output
 * @param {boolean} [options.flatten=true] - Flatten the resulting PDF
 * @param {Object} [options.info] - info fields to be set in the output PDF
 * @param {Date} [options.info.CreationDate] - The date and time the document was created
 * @param {Date} [options.info.ModDate - The date and time the document was most recently modified
 * @param {string} [options.info.Title] - The document’s title.
 * @param {string} [options.info.Author] - The name of the person who created the document.
 * @param {string} [options.info.Subject] - The subject of the document.
 * @param {string} [options.info.Keywords] - Keywords associated with the document.
 * @param {string} [options.info.Creator] - If the document was converted to PDF from another format,
 *   the name of the application that created the original document from which it was converted.
 * @param {string} [options.info.Producer] - If the document was converted to PDF from another format,
 *   the name of the application that converted it to PDF.
 * @param {boolean} [options.verbose=false] - Print stuff to the console
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
  const { flatten = true, info, verbose = false } = options
  if (verbose) {
    var label = `fill(${Math.random().toString().substr(2,3)})`
    console.log(label + ':', 'Filling PDF', pdf, 'with fields', fields, 'and options', options)
    console.time(label)
  }
  let xfdf
  return new Promise((resolve, reject) => {
    fs.access(pdf, fs.constants.R_OK, (err) => {
      if (err) reject(err)
      else resolve(pdf)
    })
  })
  .then(pdf => info ? setInfo(pdf, info) : pdf)
  .then(pdf => new Promise((resolve, reject) => {
    tmp.file((err, xfdf, fd) => {
      if (err) return reject(err)
      const xfdfBuilder = new XFDF({ pdf })
      xfdfBuilder.fromJSON({ fields })
      fs.write(fd, xfdfBuilder.generate(), (err, written) => {
        if (err) reject(err)
        else if (written === 0) reject('xfdf wrote 0 bytes!')
        else resolve({ pdf, xfdf })
      })
    })
  }))
  .then(({ pdf, xfdf }) => fillForm(pdf, xfdf, flatten))
  .then(output => {
    if (verbose) console.timeEnd(label)
    return output
  })
  .catch(err => {
    if (!(err instanceof Error)) err = new Error(err.toString())
    if (verbose) console.error(label + ':', err)
    throw err
  })
}


module.exports = { fields, fill }
