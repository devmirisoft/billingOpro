import axios from 'axios'
import { validatePdf } from './invoicePdf'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api' })

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('ledgerly_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
})

export const authApi = {
    setupStatus: () => api.get('/auth/setup-status'),
    login: (payload) => api.post('/auth/login', payload),
    register: (payload) => api.post('/auth/register', payload),
}

export const dataApi = {
    products: () => api.get('/products'),
    createProduct: (payload) => api.post('/products', payload),
    updateProduct: (id, payload) => api.put(`/products/${id}`, payload),
    deleteProduct: (id) => api.delete(`/products/${id}`),
    invoices: (params = {}) => api.get('/invoices', { params }),
    getInvoice: (id) => api.get(`/invoices/${id}`),
    createInvoice: (payload) => api.post('/invoices', payload),
    updateInvoice: (id, payload) => api.put(`/invoices/${id}`, payload),
    updateInvoicePayment: (id, payload) => api.patch(`/invoices/${id}/payment`, payload),
    updateInvoiceEInvoice: (id, payload) => api.patch(`/invoices/${id}/e-invoice`, payload),
    invoicePdf: async (id, signal) => {
        const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob', signal, timeout: 30000 })
        response.data = await validatePdf(response.data)
        return response
    },
    deleteInvoice: (id) => api.delete(`/invoices/${id}`),
    customers: (searchOrParams = '') => {
        const params = typeof searchOrParams === 'string' ? (searchOrParams ? { search: searchOrParams } : {}) : (searchOrParams || {})
        return api.get('/customers', { params })
    },
    createCustomer: (payload) => api.post('/customers', payload),
    updateCustomer: (id, payload) => api.put(`/customers/${id}`, payload),
    lookupPinCode: (pinCode) => api.get(`/location/pincode/${pinCode}`),
    settings: () => api.get('/settings'),
    updateSettings: (payload) => api.put('/settings', payload),
}

export default api
