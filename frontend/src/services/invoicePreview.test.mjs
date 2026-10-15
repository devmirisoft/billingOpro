import test from 'node:test'
import assert from 'node:assert/strict'
import { createInvoicePreview } from './invoicePreview.js'
import { validatePdf, pdfErrorMessage } from './invoicePdf.js'

const blob = new Blob(['%PDF-1.7\nfixture\n%%EOF'], { type: 'application/pdf' })
const invoice = { id: 'abc', number: 'INV-1' }
function setup() {
  const pending = [], states = []
  const controller = createInvoicePreview((id, signal) => new Promise((resolve, reject) => pending.push({ id, signal, resolve, reject })), (state) => states.push(state))
  return { controller, pending, states }
}

test('latest invoice wins even if the cancelled request completes last', async () => {
  const { controller, pending, states } = setup()
  const first = controller.open(invoice)
  const second = controller.open({ ...invoice, id: 'def' })
  assert.equal(pending[0].signal.aborted, true)
  pending[1].resolve({ data: blob })
  await second
  const url = states.at(-1).url
  pending[0].resolve({ data: blob })
  await first
  assert.equal(states.at(-1).invoice.id, 'def')
  assert.equal(states.at(-1).url, url)
  controller.dispose()
  await assert.rejects(fetch(url))
})

for (const action of ['close', 'dispose']) {
  test(`${action} cancels requests and ignores late completion`, async () => {
    const { controller, pending, states } = setup()
    const request = controller.open(invoice)
    controller[action]()
    const count = states.length
    pending[0].resolve({ data: blob })
    await request
    assert.equal(states.length, count)
    assert.equal(pending[0].signal.aborted, true)
    if (action === 'close') assert.equal(states.at(-1), null)
  })
}

test('replacement releases the old URL; closing releases the current URL', async () => {
  const { controller, pending, states } = setup()
  const first = controller.open(invoice)
  pending[0].resolve({ data: blob })
  await first
  const oldUrl = states.at(-1).url
  assert.equal((await fetch(oldUrl)).status, 200)
  const second = controller.open(invoice)
  await assert.rejects(fetch(oldUrl))
  pending[1].resolve({ data: blob })
  await second
  const newUrl = states.at(-1).url
  assert.equal((await fetch(newUrl)).status, 200)
  controller.close()
  await assert.rejects(fetch(newUrl))
})

test('failure can be retried successfully', async () => {
  const { controller, pending, states } = setup()
  const first = controller.open(invoice)
  pending[0].reject({ response: { status: 500 } })
  await first
  assert.match(states.at(-1).error, /generate/)
  const retry = controller.open(invoice)
  assert.equal(states.at(-1).loading, true)
  pending[1].resolve({ data: blob })
  await retry
  assert.equal(states.at(-1).error, '')
  controller.dispose()
})

test('a stale failure cannot replace the current preview', async () => {
  const { controller, pending, states } = setup()
  const first = controller.open(invoice)
  const second = controller.open({ ...invoice, id: 'def' })
  pending[1].resolve({ data: blob })
  await second
  const current = states.at(-1)
  pending[0].reject(new Error('Old request failed'))
  await first
  assert.equal(states.at(-1), current)
  controller.dispose()
})

test('PDF validation rejects empty, JSON, HTML responses and normalizes MIME type', async () => {
  for (const value of [new Blob([]), new Blob(['{}']), new Blob(['<html>error</html>']), null]) await assert.rejects(validatePdf(value), /valid PDF/)
  assert.equal(await validatePdf(blob), blob)
  assert.equal((await validatePdf(new Blob([blob]))).type, 'application/pdf')
})

test('errors explain authentication, missing invoice, server, timeout and connection failures', () => {
  for (const [status, expected] of [[401, /sign in/], [403, /denied/], [404, /not be found/], [500, /generate/]]) assert.match(pdfErrorMessage({ response: { status } }), expected)
  assert.match(pdfErrorMessage({ code: 'ECONNABORTED' }), /timed out/)
  assert.match(pdfErrorMessage({ request: {} }), /connection/)
})
