require('express-async-errors')
const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const PDFDocument = require('pdfkit')
require('dotenv').config()

const app = express()
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174').split(',').map((origin) => origin.trim()).filter(Boolean)
app.use(cors({ origin: (origin, callback) => { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origin is not allowed')) } }))
app.use(express.json({ limit: '5mb' }))

const userSchema = new mongoose.Schema({ name: String, email: { type: String, unique: true, lowercase: true }, password: String }, { timestamps: true })
const productSchema = new mongoose.Schema({ name: { type: String, required: true }, productCode: { type: String, required: true, index: true }, sellingPrice: { type: Number, min: 0, required: true }, gstRate: { type: Number, min: 0, max: 100, required: true }, hsnCode: { type: String, required: true, trim: true, match: /^\d{1,8}$/ }, unit: String, description: String, priceIncludesGST: { type: Boolean, default: false }, isActive: { type: Boolean, default: true } }, { timestamps: true })
const customerSchema = new mongoose.Schema({ name: { type: String, required: true }, mobile: { type: String, required: true, index: true }, email: String, address: String, state: String, gstin: { type: String, trim: true, uppercase: true, maxlength: 15 }, lastBilledAt: Date }, { timestamps: true })
const invoiceItemSchema = new mongoose.Schema({ productId: mongoose.Schema.Types.ObjectId, productName: String, productCode: String, hsnCode: { type: String, required: true, trim: true, match: /^\d{1,8}$/ }, quantity: Number, unit: String, price: Number, discountPercent: { type: Number, min: 0, max: 100, default: 0 }, gstRate: Number, taxableAmount: Number, cgstRate: Number, cgstAmount: Number, sgstRate: Number, sgstAmount: Number, igstRate: Number, igstAmount: Number, total: Number }, { _id: false })
const invoiceSchema = new mongoose.Schema({ invoiceNumber: { type: String, unique: true, index: true }, invoiceSequence: { type: Number, unique: true }, customer: Object, items: [invoiceItemSchema], subtotal: Number, discountType: String, discountValue: Number, discountAmount: Number, taxableAmount: Number, cgstTotal: Number, sgstTotal: Number, igstTotal: Number, totalGST: Number, roundOff: Number, grandTotal: Number, paymentMethod: String, paymentStatus: String, amountPaid: Number, balanceAmount: Number, invoiceDate: Date, vehicleNumber: { type: String, trim: true, maxlength: 30 }, lrNumber: { type: String, trim: true, maxlength: 40 }, irn: String, ackNo: String, ackDate: Date, ewayBillNo: String, signedQrDataUrl: String, signedQrText: String, createdBy: mongoose.Schema.Types.ObjectId }, { timestamps: true })
const settingsSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, unique: true }, businessName: String, ownerName: String, address: String, city: String, state: String, pinCode: String, phone: String, email: String, gstin: String, logoDataUrl: String, qrDataUrl: String, invoicePrefix: { type: String, default: 'INV' }, nextInvoiceNumber: { type: Number, default: 1 }, defaultGstRate: { type: Number, default: 18 }, allowRateEditing: { type: Boolean, default: true }, bankDetails: Object, upiId: String, terms: String }, { timestamps: true })
const counterSchema = new mongoose.Schema({ key: { type: String, unique: true }, value: { type: Number, default: 0 } })
const User = mongoose.model('User', userSchema); const Product = mongoose.model('Product', productSchema); const Customer = mongoose.model('Customer', customerSchema); const Invoice = mongoose.model('Invoice', invoiceSchema); const Settings = mongoose.model('Settings', settingsSchema); const Counter = mongoose.model('Counter', counterSchema)

const auth = (req, res, next) => { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ message: 'Authentication required' }); try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'development-secret'); next() } catch { return res.status(401).json({ message: 'Invalid or expired session' }) } }
const round = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100
const mobileDigits = (value = '') => String(value).replace(/\D/g, '').slice(-10)
const numberWords = (value) => { const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']; const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']; const underHundred = (number) => number < 20 ? ones[number] : `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ''}`; const underThousand = (number) => number < 100 ? underHundred(number) : `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${underHundred(number % 100)}` : ''}`; const amount = Math.floor(Number(value || 0)); if (amount === 0) return 'Zero Rupees'; const parts = []; const crore = Math.floor(amount / 10000000); const lakh = Math.floor((amount % 10000000) / 100000); const thousand = Math.floor((amount % 100000) / 1000); const remainder = amount % 1000; if (crore) parts.push(`${underThousand(crore)} Crore`); if (lakh) parts.push(`${underThousand(lakh)} Lakh`); if (thousand) parts.push(`${underThousand(thousand)} Thousand`); if (remainder) parts.push(underThousand(remainder)); return `${parts.join(' ')} Rupees`; }
const hasValidMobile = (value) => /^\d{10}$/.test(mobileDigits(value))
const logoPattern = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/
const logoBuffer = (dataUrl) => dataUrl ? Buffer.from(dataUrl.split(',')[1], 'base64') : null
const cleanInvoiceText = (value = '', maxLength = 250) => String(value || '').trim().slice(0, maxLength)
const cleanEInvoiceFields = (body = {}) => ({
    irn: cleanInvoiceText(body.irn, 100),
    ackNo: cleanInvoiceText(body.ackNo, 40),
    ackDate: body.ackDate ? new Date(body.ackDate) : undefined,
    ewayBillNo: cleanInvoiceText(body.ewayBillNo, 40),
    signedQrDataUrl: logoPattern.test(String(body.signedQrDataUrl || '')) ? body.signedQrDataUrl : '',
    signedQrText: cleanInvoiceText(body.signedQrText, 4000)
})
const errorHandler = (error, req, res, next) => { console.error(error); if (error.code === 11000) return res.status(409).json({ message: 'An account with that email already exists' }); if (error.name === 'ValidationError') return res.status(400).json({ message: Object.values(error.errors).map((item) => item.message).join(', ') }); return res.status(error.status || 500).json({ message: 'Something went wrong. Please try again.' }) }

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'billing-pro-api' }))
app.post('/api/auth/register', async (req, res) => { const { name, email, password } = req.body; if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email and an 8-character password are required' }); const user = await User.create({ name, email, password: await bcrypt.hash(password, 12) }); res.status(201).json({ id: user.id, name: user.name, email: user.email }) })
app.post('/api/auth/login', async (req, res) => { const user = await User.findOne({ email: req.body.email }); if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' }); const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, process.env.JWT_SECRET || 'development-secret', { expiresIn: '7d' }); res.json({ token, user: { id: user.id, name: user.name, email: user.email } }) })
app.get('/api/products', auth, async (req, res) => res.json(await Product.find({ isActive: true }).sort({ createdAt: -1 }).limit(200)))
app.post('/api/products', auth, async (req, res) => res.status(201).json(await Product.create(req.body)))
app.put('/api/products/:id', auth, async (req, res) => res.json(await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })))
app.delete('/api/products/:id', auth, async (req, res) => { await Product.findByIdAndUpdate(req.params.id, { isActive: false }); res.status(204).end() })
app.get('/api/customers', auth, async (req, res) => { const query = req.query.search ? { $or: [{ name: new RegExp(req.query.search, 'i') }, { mobile: new RegExp(req.query.search, 'i') }] } : {}; res.json(await Customer.find(query).sort({ name: 1 })) })
app.post('/api/customers', auth, async (req, res) => { if (!hasValidMobile(req.body.mobile)) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' }); res.status(201).json(await Customer.create({ ...req.body, mobile: mobileDigits(req.body.mobile), gstin: String(req.body.gstin || '').trim().toUpperCase() })) })
app.put('/api/customers/:id', auth, async (req, res) => { if (req.body.mobile && !hasValidMobile(req.body.mobile)) return res.status(400).json({ message: 'Mobile number must be exactly 10 digits' }); res.json(await Customer.findByIdAndUpdate(req.params.id, { ...req.body, mobile: req.body.mobile ? mobileDigits(req.body.mobile) : req.body.mobile }, { new: true, runValidators: true })) })
app.delete('/api/customers/:id', auth, async (req, res) => { await Customer.findByIdAndDelete(req.params.id); res.status(204).end() })
app.get('/api/location/pincode/:pinCode', auth, async (req, res) => {
    const pinCode = String(req.params.pinCode || '').replace(/\D/g, '')
    if (!/^\d{6}$/.test(pinCode)) return res.status(400).json({ message: 'PIN code must be exactly 6 digits' })
    const response = await fetch(`https://api.postalpincode.in/pincode/${pinCode}`)
    if (!response.ok) return res.status(502).json({ message: 'PIN lookup service is unavailable' })
    const data = await response.json()
    const postOffice = data?.[0]?.PostOffice?.[0]
    if (!postOffice || data?.[0]?.Status !== 'Success') return res.status(404).json({ message: 'No city or state found for this PIN code' })
    res.json({ pinCode, city: postOffice.District || postOffice.Block || postOffice.Name || '', state: postOffice.State || '' })
})
app.get('/api/invoices', auth, async (req, res) => { const page = Math.max(Number(req.query.page) || 1, 1); const limit = Math.min(Number(req.query.limit) || 20, 100); const filter = {}; if (req.query.status) filter.paymentStatus = req.query.status; if (req.query.search) filter.$or = [{ invoiceNumber: new RegExp(req.query.search, 'i') }, { 'customer.name': new RegExp(req.query.search, 'i') }, { 'customer.mobile': new RegExp(req.query.search, 'i') }]; const [data, total] = await Promise.all([Invoice.find(filter).sort({ invoiceDate: -1 }).skip((page - 1) * limit).limit(limit), Invoice.countDocuments(filter)]); res.json({ data, page, pages: Math.ceil(total / limit), total }) })
app.post('/api/invoices', auth, async (req, res) => { const payload = { ...req.body, ...cleanEInvoiceFields(req.body), customer: { ...req.body.customer, mobile: mobileDigits(req.body.customer?.mobile), gstin: String(req.body.customer?.gstin || '').trim().toUpperCase() } }; if (!payload.items?.length) return res.status(400).json({ message: 'At least one invoice item is required' }); if (payload.items.some((item) => !/^\d{1,8}$/.test(String(item.hsnCode || '').trim()))) return res.status(400).json({ message: 'HSN/SAC code is required and must contain 1 to 8 digits for every item' }); if (!hasValidMobile(payload.customer?.mobile)) return res.status(400).json({ message: 'Customer mobile number must be exactly 10 digits' }); const counter = await Counter.findOneAndUpdate({ key: 'invoice' }, { $inc: { value: 1 } }, { new: true, upsert: true, setDefaultsOnInsert: true }); const settings = await Settings.findOne({ userId: req.user.id }); const supplierState = String(settings?.state || payload.businessState || '').trim().toLowerCase(); const customerState = String(payload.customer?.state || '').trim().toLowerCase(); const interstate = Boolean(supplierState && customerState && supplierState !== customerState); const prefix = settings?.invoicePrefix || 'INV'; const discountRate = Math.min(100, Math.max(0, Number(payload.discountValue) || 0)); const items = payload.items.map((item) => { const grossAmount = round(Number(item.quantity) * Number(item.price)); const itemDiscountRate = Math.min(100, Math.max(0, Number(item.discountPercent) || 0)); const itemDiscount = round(grossAmount * itemDiscountRate / 100); const taxableBeforeInvoiceDiscount = round(grossAmount - itemDiscount); const taxableAmount = round(taxableBeforeInvoiceDiscount * (1 - discountRate / 100)); const gst = round(taxableAmount * Number(item.gstRate) / 100); return { ...item, discountPercent: itemDiscountRate, taxableAmount, cgstRate: interstate ? 0 : Number(item.gstRate) / 2, cgstAmount: interstate ? 0 : round(gst / 2), sgstRate: interstate ? 0 : Number(item.gstRate) / 2, sgstAmount: interstate ? 0 : round(gst / 2), igstRate: interstate ? Number(item.gstRate) : 0, igstAmount: interstate ? gst : 0, total: round(taxableAmount + gst) } }); const subtotal = round(items.reduce((sum, item) => sum + round(Number(item.quantity) * Number(item.price), 2), 0)); const itemDiscountAmount = round(items.reduce((sum, item) => sum + round(Number(item.quantity) * Number(item.price) * (Number(item.discountPercent) || 0) / 100, 2), 0)); const afterItemDiscount = round(subtotal - itemDiscountAmount); const discountAmount = round(afterItemDiscount * discountRate / 100); const taxableAmount = round(afterItemDiscount - discountAmount); const cgstTotal = round(items.reduce((sum, item) => sum + item.cgstAmount, 0)); const sgstTotal = round(items.reduce((sum, item) => sum + item.sgstAmount, 0)); const igstTotal = round(items.reduce((sum, item) => sum + item.igstAmount, 0)); const grandTotal = round(taxableAmount + cgstTotal + sgstTotal + igstTotal); const paidAmount = Math.min(Math.max(Number(payload.amountPaid) || 0, 0), grandTotal); const balanceAmount = round(grandTotal - paidAmount); const paymentStatus = paidAmount >= grandTotal ? 'Paid' : paidAmount > 0 ? 'Partially paid' : 'Unpaid'; const invoiceDate = payload.invoiceDate ? new Date(payload.invoiceDate) : new Date(); await Customer.findOneAndUpdate({ mobile: payload.customer.mobile }, { name: payload.customer.name || 'Customer', mobile: payload.customer.mobile, state: payload.customer.state, gstin: payload.customer.gstin, address: payload.customer.address, lastBilledAt: invoiceDate }, { upsert: true, new: true, setDefaultsOnInsert: true }); const invoice = await Invoice.create({ ...payload, invoiceDate, items, invoiceSequence: counter.value, invoiceNumber: `${prefix}-${String(counter.value).padStart(6, '0')}`, subtotal, discountValue: discountRate, discountAmount, taxableAmount, cgstTotal, sgstTotal, igstTotal, totalGST: round(cgstTotal + sgstTotal + igstTotal), grandTotal, paymentStatus, amountPaid: paidAmount, balanceAmount, createdBy: req.user.id }); res.status(201).json(invoice) })
app.patch('/api/invoices/:id/payment', auth, async (req, res) => { const invoice = await Invoice.findOne({ _id: req.params.id, createdBy: req.user.id }); if (!invoice) return res.status(404).json({ message: 'Invoice not found' }); const amountReceived = Math.max(Number(req.body.amountReceived) || 0, 0); if (amountReceived <= 0) return res.status(400).json({ message: 'Amount received must be greater than zero' }); const grandTotal = Number(invoice.grandTotal) || 0; const amountPaid = Math.min(round(Number(invoice.amountPaid || 0) + amountReceived), grandTotal); const balanceAmount = round(grandTotal - amountPaid); invoice.amountPaid = amountPaid; invoice.balanceAmount = balanceAmount; invoice.paymentStatus = amountPaid >= grandTotal ? 'Paid' : amountPaid > 0 ? 'Partially paid' : 'Unpaid'; await invoice.save(); res.json(invoice) })
app.patch('/api/invoices/:id/e-invoice', auth, async (req, res) => { const invoice = await Invoice.findOne({ _id: req.params.id, createdBy: req.user.id }); if (!invoice) return res.status(404).json({ message: 'Invoice not found' }); Object.assign(invoice, cleanEInvoiceFields(req.body)); await invoice.save(); res.json(invoice) })
app.delete('/api/invoices/:id', auth, async (req, res) => { const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, createdBy: req.user.id }); if (!invoice) return res.status(404).json({ message: 'Invoice not found' }); res.status(204).end() })
app.get('/api/invoices/:id/pdf', auth, async (req, res, next) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid invoice ID' })
    const invoice = await Invoice.findById(req.params.id)
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' })
    const settings = await Settings.findOne({ userId: invoice.createdBy || req.user.id })
    const bank = settings?.bankDetails || {}
    const doc = new PDFDocument({ size: 'A4', margin: 32 })
    const currency = (value) => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const shortDate = (value) => new Date(value || Date.now()).toLocaleDateString('en-IN')
    const pageWidth = doc.page.width
    const pageHeight = doc.page.height
    const bronze = '#b57505'
    const bronzeDark = '#704400'
    const gold = '#d69a13'
    const paleGold = '#fbf6ea'
    const ink = '#111827'
    const muted = '#4b5563'
    const lineColor = '#ead8b9'
    const invoiceDate = invoice.invoiceDate || invoice.createdAt
    const address = [settings?.address, settings?.city, settings?.state, settings?.pinCode].filter(Boolean).join(', ')
    const customerAddress = invoice.customer?.billingAddress || invoice.customer?.address || invoice.customer?.state || ''
    const shippingAddress = invoice.customer?.shippingAddress || customerAddress
    const addressParts = (value = '') => {
        const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean)
        const pinFromText = String(value || '').match(/\b\d{6}\b/)?.[0] || ''
        const pinIndex = parts.findIndex((part) => /\b\d{6}\b/.test(part))
        const pinCode = pinFromText || ''
        const withoutPin = parts.filter((_, index) => index !== pinIndex)
        const state = withoutPin.length > 2 ? withoutPin[withoutPin.length - 1] : invoice.customer?.state || ''
        const city = withoutPin.length > 1 ? withoutPin[withoutPin.length - 2] : ''
        const line1 = withoutPin.length > 2 ? withoutPin.slice(0, -2).join(', ') : withoutPin[0] || ''
        return { line1, city, state, pinCode }
    }
    const invoiceItems = Array.isArray(invoice.items) ? invoice.items : []
    const amountInWords = (value) => `INR ${numberWords(value)} Only`
    const formatPercent = (value) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 2 : 0)}%`
    const totalQuantity = () => invoiceItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    const businessState = String(settings?.state || '').trim().toLowerCase()
    const customerState = String(invoice.customer?.state || addressParts(customerAddress).state || '').trim().toLowerCase()
    const interstateInvoice = Number(invoice.igstTotal || 0) > 0 || (businessState && customerState && businessState !== customerState)
    const tableHeaderHeight = 24
    const tableRowHeight = 27
    const tableSummaryHeight = 48
    const finalSectionsHeight = 355
    const pageBottom = pageHeight - doc.page.margins.bottom
    const rowsPerFirstPage = invoiceItems.length <= 5 ? 5 : Math.max(1, Math.floor((pageBottom - 300 - tableHeaderHeight - tableSummaryHeight - finalSectionsHeight - 20) / tableRowHeight))
    const rowsPerNextPage = Math.max(1, Math.floor((pageBottom - 150 - tableHeaderHeight - tableSummaryHeight - finalSectionsHeight - 20) / tableRowHeight))
    const chunks = []
    invoiceItems.forEach((item, index) => {
        const limit = chunks.length ? rowsPerNextPage : rowsPerFirstPage
        if (!chunks.length || chunks[chunks.length - 1].length >= limit) chunks.push([])
        chunks[chunks.length - 1].push({ item, serial: index + 1 })
    })
    if (!chunks.length) chunks.push([])
    const lastTableStart = chunks.length === 1 ? 300 : 150
    const lastTableBodyRows = chunks[chunks.length - 1].length
    const lastTableBottom = lastTableStart + tableHeaderHeight + lastTableBodyRows * tableRowHeight + tableSummaryHeight
    const footerTopOnLastTablePage = lastTableBottom
    const finalPageSeparate = footerTopOnLastTablePage + finalSectionsHeight > pageBottom
    const totalPages = chunks.length + (finalPageSeparate ? 1 : 0)

    const drawWaveChrome = (pageNumber) => {
        doc.save()
        doc.rect(0, 0, pageWidth, pageHeight).fill('#ffffff')
        doc.path(`M0 0 L${pageWidth} 0 L${pageWidth} 34 C505 58 452 60 393 39 C314 11 204 0 96 19 C58 26 25 45 0 69 Z`).fill('#f7f1e6')
        doc.path(`M355 0 C422 11 470 76 557 9 L${pageWidth} 0 Z`).fill('#f1c455')
        doc.path(`M446 0 C486 51 535 46 ${pageWidth} 2 L${pageWidth} 0 Z`).fill(bronzeDark)
        doc.restore()

        roundedBox(30, 66, 118, 88, '#ffffff')
        if (settings?.logoDataUrl && logoPattern.test(settings.logoDataUrl)) {
            try {
                doc.image(logoBuffer(settings.logoDataUrl), 41, 76, { fit: [96, 66], align: 'center', valign: 'center' })
            } catch (error) {
                console.error('Could not render invoice logo:', error.message)
                doc.font('Helvetica-Bold').fontSize(10).fillColor(bronze).text(settings?.businessName || 'Logo', 46, 103, { width: 86, align: 'center' })
            }
        } else {
            doc.font('Helvetica-Bold').fontSize(10).fillColor(bronze).text(settings?.businessName || 'Business Logo', 46, 103, { width: 86, align: 'center' })
        }

        doc.font('Helvetica-Bold').fontSize(22).fillColor(bronze).text(settings?.businessName || 'Trading Company', 166, 76, { width: 235 })
        doc.moveTo(166, 105).lineTo(330, 105).lineWidth(1).strokeColor(gold).stroke()
        doc.font('Helvetica').fontSize(8).fillColor(muted).text(`GSTIN: ${settings?.gstin || '-'}`, 166, 114)
        if (pageNumber === 1) {
            doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Phone: ${settings?.phone || '-'}`, 166, 130)
            doc.text(`Email: ${settings?.email || '-'}`, 300, 130)
            doc.text(address || 'Business address', 166, 145, { width: 330 })
            if (settings?.ownerName) doc.text(`Owner: ${settings.ownerName}`, 166, 160, { width: 250 })
        }
        doc.font('Helvetica-Bold').fontSize(15).fillColor(bronzeDark).text('TAX INVOICE', 375, 76, { width: 155, align: 'right', lineBreak: false })
        doc.font('Helvetica').fontSize(8).fillColor(muted).text(`Invoice No: ${invoice.invoiceNumber}`, 390, 104, { width: 140, align: 'right' })
        doc.text(`Page ${pageNumber} of ${totalPages}`, 390, 120, { width: 140, align: 'right' })
        doc.font('Helvetica').fontSize(8).fillColor(ink).text(`Page ${pageNumber} of ${totalPages}`, 465, 760, { width: 70, align: 'right' })
    }
    const roundedBox = (x, y, w, h, fill = '#ffffff') => doc.roundedRect(x, y, w, h, 7).fillAndStroke(fill, lineColor)
    const iconCircle = (x, y, label) => {
        doc.circle(x, y, 13).fill(bronze)
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff').text(label, x - 7, y - 5, { width: 14, align: 'center' })
    }
    const drawTable = (items, yStart, includeSummary = false) => {
        const cols = [38, 62, 220, 274, 312, 352, 398, 432, 469, 512]
        const widths = [22, 155, 50, 34, 38, 42, 30, 31, 34, 51]
        doc.roundedRect(30, yStart, 535, tableHeaderHeight, 5).fill(bronze)
        ;['Sl No.', 'Description of Goods', 'HSN/SAC', 'GST Rate', 'Quantity', 'Rate (Incl. Tax)', 'Rate', 'Per', 'Disc. %', 'Amount (Rs.)'].forEach((heading, index) => {
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff').text(heading, cols[index], yStart + 7, { width: widths[index], align: index > 1 ? 'right' : 'left', lineBreak: false })
        })
        let y = yStart + tableHeaderHeight
        items.forEach(({ item, serial }, index) => {
            const rowFill = index % 2 ? '#fffaf2' : '#ffffff'
            doc.rect(30, y, 535, tableRowHeight).fillAndStroke(rowFill, lineColor)
            doc.font('Helvetica').fontSize(7.5).fillColor(ink)
            doc.text(String(serial), cols[0], y + 8, { width: widths[0], align: 'center' })
            doc.font('Helvetica-Bold').text(item.productName || 'Product', cols[1], y + 4, { width: widths[1], height: 19, lineGap: 1 })
            doc.font('Helvetica').fontSize(7.2).fillColor(ink).text(item.hsnCode || '-', cols[2], y + 8, { width: widths[2], align: 'right', lineBreak: false })
            doc.font('Helvetica').fontSize(7.5).fillColor(ink).text(`${item.gstRate || 0}%`, cols[3], y + 8, { width: widths[3], align: 'right' })
            doc.text(`${item.quantity || 0} ${item.unit || 'Nos'}`, cols[4], y + 8, { width: widths[4], align: 'right' })
            doc.text(currency(Number(item.price) * (1 + Number(item.gstRate || 0) / 100)), cols[5], y + 8, { width: widths[5], align: 'right' })
            doc.text(currency(item.price), cols[6], y + 8, { width: widths[6], align: 'right' })
            doc.text(item.unit || 'Nos', cols[7], y + 8, { width: widths[7], align: 'right' })
            doc.text(formatPercent(item.discountPercent), cols[8], y + 8, { width: widths[8], align: 'right' })
            doc.text(currency(item.taxableAmount), cols[9], y + 8, { width: widths[9], align: 'right' })
            y += tableRowHeight
        })
        if (includeSummary) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(ink)
            doc.rect(30, y, 535, 24).fillAndStroke('#ffffff', lineColor)
            doc.text('Total', 250, y + 8, { width: 55, align: 'right' })
            const invoiceUnit = invoiceItems.length && invoiceItems.every((item) => (item.unit || 'Nos') === (invoiceItems[0].unit || 'Nos')) ? invoiceItems[0].unit || 'Nos' : 'Units'
            doc.fontSize(8.5).text(`${totalQuantity()} ${invoiceUnit}`, 312, y + 8, { width: 86, align: 'right' })
            doc.text(`Rs.${currency(invoice.grandTotal)}`, 469, y + 8, { width: 84, align: 'right' })
            y += 24
            doc.rect(30, y, 535, 24).fillAndStroke('#ffffff', lineColor)
            doc.fontSize(7.5).text('Amount Chargeable (in words):', 36, y + 5)
            doc.font('Helvetica-Bold').text(amountInWords(invoice.grandTotal), 178, y + 5, { width: 275 })
            doc.font('Helvetica-Bold').text('E. & O.E', 510, y + 5, { width: 48, align: 'right' })
            y += 24
        }
        return y
    }
    const drawDetails = () => {
        doc.rect(30, 154, 535, 6).fill(ink)
        doc.rect(30, 160, 535, 38).fill(paleGold)
        doc.font('Helvetica-Bold').fontSize(8.2).fillColor(ink).text('Invoice No.:', 45, 173)
        doc.font('Helvetica').fontSize(8.2).text(invoice.invoiceNumber, 107, 173, { width: 120 })
        doc.font('Helvetica-Bold').fontSize(8.2).text('Invoice Date:', 235, 173)
        doc.font('Helvetica').fontSize(8.2).text(shortDate(invoiceDate), 303, 173, { width: 115 })
        doc.font('Helvetica-Bold').fontSize(8.2).text('Due Date:', 436, 173)
        doc.font('Helvetica').fontSize(8.2).text(shortDate(invoiceDate), 489, 173, { width: 65 })
        doc.font('Helvetica-Bold').fontSize(6.8).text('Mode/Terms:', 45, 190)
        doc.font('Helvetica').fontSize(6.8).text(invoice.paymentMethod || '-', 105, 190, { width: 105 })
        doc.font('Helvetica-Bold').fontSize(6.8).text('Motor Vehicle No.:', 235, 190)
        doc.font('Helvetica').fontSize(6.8).text(invoice.vehicleNumber || '-', 325, 190, { width: 95 })
        doc.font('Helvetica-Bold').fontSize(6.8).text('LR-RR/BL No.:', 436, 190)
        doc.font('Helvetica').fontSize(6.8).text(invoice.lrNumber || '-', 489, 190, { width: 65 })

        const drawPartyCard = (x, title, addressText) => {
            const parts = addressParts(addressText)
            roundedBox(x, 206, 255, 86, '#ffffff')
            doc.font('Helvetica-Bold').fontSize(9.6).fillColor(bronzeDark).text(title, x + 14, 214)
            doc.font('Helvetica-Bold').fontSize(8.1).fillColor(ink).text(invoice.customer?.name || 'Customer', x + 14, 229, { width: 220, height: 10, ellipsis: true })
            doc.font('Helvetica').fontSize(6.6).fillColor(ink).text(parts.line1 || '-', x + 14, 242, { width: 220, height: 9, ellipsis: true })
            doc.text(`City: ${parts.city || '-'}`, x + 14, 255, { width: 105, height: 9, ellipsis: true })
            doc.text(`PIN: ${parts.pinCode || '-'}`, x + 135, 255, { width: 90, height: 9, ellipsis: true })
            doc.text(`State: ${parts.state || invoice.customer?.state || '-'}`, x + 14, 268, { width: 105, height: 9, ellipsis: true })
            doc.text(`Mobile: ${invoice.customer?.mobile || '-'}`, x + 135, 268, { width: 95, height: 9, ellipsis: true })
            doc.text(`GSTIN: ${invoice.customer?.gstin || '-'}`, x + 14, 281, { width: 220, height: 9, ellipsis: true })
        }
        drawPartyCard(30, 'BILL TO', customerAddress)
        drawPartyCard(310, 'SHIP TO', shippingAddress, false)
    }
    const drawFinalSections = (top, continuationPage = false) => {
        const baseTop = top + 12
        const taxGroups = invoiceItems.reduce((groups, item) => {
            const key = `${item.hsnCode || '-'}-${item.gstRate || 0}`
            const current = groups.get(key) || { hsnCode: item.hsnCode || '-', gstRate: Number(item.gstRate || 0), taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }
            current.taxable += Number(item.taxableAmount || 0)
            current.cgst += Number(item.cgstAmount || 0)
            current.sgst += Number(item.sgstAmount || 0)
            current.igst += Number(item.igstAmount || 0)
            current.tax += Number(item.cgstAmount || 0) + Number(item.sgstAmount || 0) + Number(item.igstAmount || 0)
            groups.set(key, current)
            return groups
        }, new Map())
        const taxGroupRows = Array.from(taxGroups.values()).slice(0, 3)
        const taxTotalY = baseTop + 38 + taxGroupRows.length * 12 + 4
        const analysisHeight = Math.max(86, taxTotalY - baseTop + 28)
        roundedBox(30, baseTop, 535, analysisHeight, '#ffffff')
        doc.font('Helvetica-Bold').fontSize(9).fillColor(ink).text('Tax Analysis', 30, baseTop + 7, { width: 535, align: 'center' })
        doc.font('Helvetica-Bold').fontSize(6.5).text('HSN/SAC', 40, baseTop + 24, { width: 70 })
        doc.text('Taxable Value', 112, baseTop + 24, { width: 75, align: 'right' })
        doc.text(interstateInvoice ? 'IGST Rate' : 'CGST Rate', 192, baseTop + 24, { width: 55, align: 'right' })
        doc.text(interstateInvoice ? 'IGST Amt.' : 'CGST Amt.', 250, baseTop + 24, { width: 65, align: 'right' })
        doc.text(interstateInvoice ? '' : 'SGST Rate', 320, baseTop + 24, { width: 55, align: 'right' })
        doc.text(interstateInvoice ? '' : 'SGST Amt.', 378, baseTop + 24, { width: 65, align: 'right' })
        doc.text('Total Tax', 450, baseTop + 24, { width: 90, align: 'right' })
        taxGroupRows.forEach((group, index) => {
            const rowY = baseTop + 38 + index * 12
            doc.font('Helvetica').fontSize(6.5).text(group.hsnCode, 40, rowY, { width: 70 })
            doc.text(`Rs.${currency(group.taxable)}`, 112, rowY, { width: 75, align: 'right' })
            doc.text(formatPercent(interstateInvoice ? group.gstRate : group.gstRate / 2), 192, rowY, { width: 55, align: 'right' })
            doc.text(`Rs.${currency(interstateInvoice ? group.igst : group.cgst)}`, 250, rowY, { width: 65, align: 'right' })
            if (!interstateInvoice) {
                doc.text(formatPercent(group.gstRate / 2), 320, rowY, { width: 55, align: 'right' })
                doc.text(`Rs.${currency(group.sgst)}`, 378, rowY, { width: 65, align: 'right' })
            }
            doc.text(`Rs.${currency(group.tax)}`, 450, rowY, { width: 90, align: 'right' })
        })
        const taxTotal = invoiceItems.reduce((sum, item) => sum + Number(item.cgstAmount || 0) + Number(item.sgstAmount || 0) + Number(item.igstAmount || 0), 0)
        doc.font('Helvetica-Bold').fontSize(6.5).text('Total', 40, taxTotalY, { width: 70, align: 'right' })
        doc.text(`Rs.${currency(invoice.taxableAmount)}`, 112, taxTotalY, { width: 75, align: 'right' })
        doc.text(`Rs.${currency(taxTotal)}`, 450, taxTotalY, { width: 90, align: 'right' })
        doc.font('Helvetica-Bold').fontSize(6.2).text(`Tax Amount in Words: ${amountInWords(taxTotal)}`, 40, taxTotalY + 14, { width: 495 })
        const footerTop = baseTop + analysisHeight + 10
        roundedBox(30, footerTop, 265, 34, paleGold)
        iconCircle(54, footerTop + 17, 'Rs')
        doc.font('Helvetica-Bold').fontSize(7.2).fillColor(bronzeDark).text('Amount in Words', 78, footerTop + 8)
        doc.font('Helvetica').fontSize(6.4).fillColor(ink).text(amountInWords(invoice.grandTotal), 78, footerTop + 21, { width: 195, height: 9, ellipsis: true })

        roundedBox(310, footerTop, 255, 110, '#ffffff')
        const taxRows = interstateInvoice ? [['IGST', invoice.igstTotal]] : [['CGST', invoice.cgstTotal], ['SGST', invoice.sgstTotal]]
        const totals = [['Subtotal', invoice.subtotal], ['Discount', invoice.discountAmount], ['Taxable Amount', invoice.taxableAmount], ...taxRows, ['Round Off', invoice.roundOff || 0]]
        totals.forEach(([label, value], index) => {
            doc.font('Helvetica').fontSize(6.4).fillColor(ink).text(label, 324, footerTop + 8 + index * 10)
            doc.text(`Rs.${currency(value)}`, 456, footerTop + 8 + index * 10, { width: 85, align: 'right' })
        })
        doc.moveTo(324, footerTop + 64).lineTo(546, footerTop + 64).strokeColor(gold).stroke()
        doc.font('Helvetica-Bold').fontSize(7).fillColor(ink).text('Total Invoice Amount', 324, footerTop + 67)
        doc.text(`Rs.${currency(invoice.grandTotal)}`, 456, footerTop + 67, { width: 85, align: 'right' })
        doc.font('Helvetica').fontSize(6.4).text('Received Amount', 324, footerTop + 82)
        doc.text(`Rs.${currency(invoice.amountPaid)}`, 456, footerTop + 82, { width: 85, align: 'right' })
        doc.text('Current Balance', 324, footerTop + 94)
        doc.text(`Rs.${currency(invoice.balanceAmount)}`, 456, footerTop + 94, { width: 85, align: 'right' })
        doc.roundedRect(310, footerTop + 112, 255, 25, 3).fill(bronze)
        doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#ffffff').text('Grand Total', 324, footerTop + 121)
        doc.fontSize(12).text(`Rs.${currency(invoice.grandTotal)}`, 420, footerTop + 118, { width: 126, align: 'right' })

        roundedBox(30, footerTop + 42, 265, 50, '#ffffff')
        iconCircle(54, footerTop + 67, 'T')
        doc.font('Helvetica-Bold').fontSize(7.2).fillColor(bronzeDark).text('Terms & Conditions', 78, footerTop + 51)
        doc.font('Helvetica').fontSize(5.8).fillColor(muted).text(settings?.terms || 'Goods once sold will not be taken back or exchanged.\nWarranty as per manufacturer policy.\nAll disputes are subject to local jurisdiction only.', 78, footerTop + 65, { width: 195, height: 22 })

        roundedBox(30, footerTop + 100, 265, 82, '#ffffff')
        iconCircle(54, footerTop + 128, 'B')
        doc.font('Helvetica-Bold').fontSize(7.2).fillColor(bronzeDark).text('Bank Details', 78, footerTop + 110)
        const bankRows = [['Name', bank.accountHolder || settings?.businessName || '-'], ['Bank', bank.bankName || '-'], ['Account No.', bank.accountNumber || '-'], ['IFSC Code', bank.ifscCode || '-'], ['Branch', bank.branch || '-'], ['UPI ID', settings?.upiId || '-']]
        bankRows.forEach(([label, value], index) => {
            const rowY = footerTop + 127 + index * 8
            doc.font('Helvetica-Bold').fontSize(5.8).fillColor(muted).text(label, 78, rowY, { width: 54 })
            doc.font('Helvetica').fontSize(5.8).fillColor(ink).text(value, 132, rowY, { width: 82, height: 7, ellipsis: true })
        })
        const qrX = 228
        const qrY = footerTop + 120
        doc.roundedRect(qrX, qrY, 42, 42, 3).fillAndStroke('#ffffff', lineColor)
        if (settings?.qrDataUrl && logoPattern.test(settings.qrDataUrl)) {
            try {
                doc.image(logoBuffer(settings.qrDataUrl), qrX + 4, qrY + 4, { fit: [34, 34], align: 'center', valign: 'center' })
            } catch (error) {
                console.error('Could not render payment QR:', error.message)
            }
        }
        const hasPaymentQr = settings?.qrDataUrl && logoPattern.test(settings.qrDataUrl)
        const qrLabel = Number(invoice.balanceAmount || 0) <= 0 ? 'Paid in full' : hasPaymentQr ? 'Scan to Pay' : settings?.upiId ? 'QR not configured' : 'UPI not configured'
        doc.font('Helvetica-Bold').fontSize(5.4).fillColor(bronzeDark).text(qrLabel, 220, footerTop + 164, { width: 58, align: 'center' })
        if (settings?.upiId) doc.font('Helvetica').fontSize(5).fillColor(muted).text(settings.upiId, 220, footerTop + 171, { width: 58, align: 'center', ellipsis: true })

        roundedBox(310, footerTop + 148, 255, 46, '#ffffff')
        doc.moveTo(375, footerTop + 174).lineTo(500, footerTop + 174).strokeColor(gold).stroke()
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(ink).text('Authorised Signatory', 375, footerTop + 180, { width: 125, align: 'center' })
        doc.font('Helvetica').fontSize(5.7).fillColor(muted).text(settings?.businessName || 'Company', 375, footerTop + 188, { width: 125, align: 'center' })
        roundedBox(30, footerTop + 190, 265, 32, '#ffffff')
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor(bronzeDark).text('Declaration', 42, footerTop + 198)
        doc.font('Helvetica').fontSize(5.8).fillColor(ink).text('Certified that the particulars given above are true and correct.', 42, footerTop + 209, { width: 235 })
        doc.moveTo(30, footerTop + 235).lineTo(565, footerTop + 235).strokeColor(lineColor).stroke()
        doc.font('Helvetica-Bold').fontSize(6).fillColor(muted).text(`Subject to ${settings?.state || 'local'} jurisdiction`, 30, footerTop + 242, { width: 260 })
        doc.text('This is a Computer Generated Invoice', 305, footerTop + 242, { width: 260, align: 'right' })
    }

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename=Invoice-${invoice.invoiceNumber}.pdf`)
    doc.on('error', (error) => {
        console.error('Could not generate invoice PDF:', error)
        if (!res.headersSent) next(error)
        else res.destroy(error)
    })
    doc.pipe(res)
    chunks.forEach((chunk, pageIndex) => {
        if (pageIndex > 0) doc.addPage({ size: 'A4', margin: 32 })
        drawWaveChrome(pageIndex + 1)
        if (pageIndex === 0) drawDetails()
        const y = drawTable(chunk, pageIndex === 0 ? 300 : 150, pageIndex === chunks.length - 1)
        if (pageIndex === chunks.length - 1 && !finalPageSeparate) drawFinalSections(y)
    })
    if (finalPageSeparate) {
        doc.addPage({ size: 'A4', margin: 32 })
        drawWaveChrome(totalPages)
        drawFinalSections(150, true)
    }
    doc.end()
})
app.get('/api/settings', auth, async (req, res) => res.json(await Settings.findOne({ userId: req.user.id }) || {}))
app.put('/api/settings', auth, async (req, res) => { if (req.body.logoDataUrl && (!logoPattern.test(req.body.logoDataUrl) || Buffer.byteLength(req.body.logoDataUrl, 'utf8') > 1500000)) return res.status(400).json({ message: 'Logo must be a PNG, JPG, or WebP image under 1MB' }); if (req.body.qrDataUrl && (!logoPattern.test(req.body.qrDataUrl) || Buffer.byteLength(req.body.qrDataUrl, 'utf8') > 1500000)) return res.status(400).json({ message: 'Payment QR must be a PNG, JPG, or WebP image under 1MB' }); res.json(await Settings.findOneAndUpdate({ userId: req.user.id }, { ...req.body, userId: req.user.id }, { new: true, upsert: true, runValidators: true })) })
app.use(errorHandler)

const port = process.env.PORT || 5000
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ledgerly')
    .then(() => {
        console.log('MongoDB connected successfully')
        const server = app.listen(port, () => console.log(`Billing Pro API listening on ${port}`))
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`Port ${port} is already in use. Stop the existing server or set a different PORT in backend/.env.`)
                process.exit(1)
            }

            console.error('Server failed to start:', error.message)
            process.exit(1)
        })
    })
    .catch((error) => { console.error('MongoDB connection failed:', error.message); process.exit(1) })
