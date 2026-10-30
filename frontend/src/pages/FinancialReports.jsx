import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api.js'
import ModuleInsights from './ModuleInsights.jsx'
import './FinancialReports.css'

const reportTypes = [
  { id: 'ap', label: 'Accounts Payable Report', icon: 'FileText' },
  { id: 'ar', label: 'Accounts Receivable Report', icon: 'ReceiptText' },
  { id: 'fixed-assets', label: 'Fixed Assets Report', icon: 'Landmark' },
  { id: 'budgeting', label: 'Budget vs Actual Report', icon: 'ChartNoAxesCombined' },
  { id: 'gst', label: 'GST Summary Report', icon: 'Percent' },
  { id: 'financial-statement', label: 'Financial Statement', icon: 'FileBarChart' },
]

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

async function apiRequest(path) {
  const response = await apiFetch(path)
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status}).`)
  }
  return data
}

function formatMinor(value) {
  return currency.format((Number(value) || 0) / 100)
}

function currentDateValue() {
  return new Date().toISOString().slice(0, 10)
}

function isWithinRange(value, startDate, endDate) {
  return typeof value === 'string' && value >= startDate && value <= endDate
}

function invoiceReportRows(records, settlements, startDate, endDate) {
  const settlementById = new Map(settlements.map((settlement) => [settlement.invoice_record_id, settlement]))
  return records
    .filter((record) => isWithinRange(record.data.invoice_date, startDate, endDate))
    .map((record) => {
      const settlement = settlementById.get(record.id)
      const amountMinor = Math.round(Number(record.data.amount || 0) * 100)
      const taxMinor = Number(record.data.tax_amount_minor || 0)
      const invoiceTotalMinor = settlement?.invoice_total_minor ?? amountMinor + taxMinor
      return {
        id: record.id,
        invoice: record.data.invoice_no || record.name,
        party: record.data.supplier || record.data.customer || '—',
        invoiceDate: record.data.invoice_date,
        dueDate: record.data.due_date || '—',
        amountMinor,
        taxMinor,
        invoiceTotalMinor,
        paidMinor: settlement?.paid_minor || 0,
        outstandingMinor: record.status === 'Posted' ? settlement?.outstanding_minor ?? invoiceTotalMinor : 0,
        status: record.status,
      }
    })
}

function csvDownload(reportType, columns, rows, startDate, endDate) {
  const csvRows = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => row[column.key] ?? '')),
  ]
  const csv = `\uFEFF${csvRows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${reportType}-${startDate}-${endDate}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function FinancialReports({ role = 'requester' }) {
  const [reportType, setReportType] = useState('ap')
  const [years, setYears] = useState([])
  const [periods, setPeriods] = useState([])
  const [company, setCompany] = useState('all')
  const [fiscalYearId, setFiscalYearId] = useState('')
  const [periodId, setPeriodId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [result, setResult] = useState(null)
  const [loadingOptions, setLoadingOptions] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const companies = useMemo(
    () => [...new Set(years.map((year) => year.company).filter(Boolean))].sort(),
    [years],
  )
  const visibleYears = years.filter((year) => company === 'all' || year.company === company)
  const selectedYear = visibleYears.find((year) => String(year.id) === fiscalYearId)
  const visiblePeriods = periods.filter((period) => String(period.fiscal_year_id) === fiscalYearId)
  const selectedPeriod = visiblePeriods.find((period) => String(period.id) === periodId)
  const columns = result?.columns || []
  const rows = result?.rows || []

  useEffect(() => {
    let cancelled = false
    Promise.all([apiRequest('/api/fiscal-years'), apiRequest('/api/fiscal-periods')])
      .then(([yearItems, periodItems]) => {
        if (cancelled) return
        setYears(yearItems)
        setPeriods(periodItems)
        const initialYear = yearItems.find((year) => year.status === 'ACTIVE') || yearItems[0]
        if (initialYear) {
          setFiscalYearId(String(initialYear.id))
          const today = currentDateValue()
          const yearPeriods = periodItems.filter((period) => period.fiscal_year_id === initialYear.id)
          const initialPeriod = yearPeriods.find((period) => period.start_date <= today && period.end_date >= today)
            || yearPeriods[0]
          if (initialPeriod) {
            setPeriodId(String(initialPeriod.id))
            setStartDate(initialPeriod.start_date)
            setEndDate(initialPeriod.end_date)
          } else {
            setStartDate(initialYear.start)
            setEndDate(initialYear.end)
          }
        }
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.message) })
      .finally(() => { if (!cancelled) setLoadingOptions(false) })
    return () => { cancelled = true }
  }, [])

  function changeCompany(value) {
    const nextYears = years.filter((year) => value === 'all' || year.company === value)
    const nextYear = nextYears.find((year) => year.status === 'ACTIVE') || nextYears[0]
    const nextPeriods = nextYear ? periods.filter((period) => period.fiscal_year_id === nextYear.id) : []
    const nextPeriod = nextPeriods[0]
    setCompany(value)
    setFiscalYearId(nextYear ? String(nextYear.id) : '')
    setPeriodId(nextPeriod ? String(nextPeriod.id) : '')
    setStartDate(nextPeriod?.start_date || nextYear?.start || '')
    setEndDate(nextPeriod?.end_date || nextYear?.end || '')
    setResult(null)
  }

  function changeFiscalYear(value) {
    const nextYear = visibleYears.find((year) => String(year.id) === value)
    const nextPeriods = periods.filter((period) => String(period.fiscal_year_id) === value)
    const today = currentDateValue()
    const nextPeriod = nextPeriods.find((period) => period.start_date <= today && period.end_date >= today)
      || nextPeriods[0]
    setFiscalYearId(value)
    setPeriodId(nextPeriod ? String(nextPeriod.id) : '')
    setStartDate(nextPeriod?.start_date || nextYear?.start || '')
    setEndDate(nextPeriod?.end_date || nextYear?.end || '')
    setResult(null)
  }

  function changePeriod(value) {
    const nextPeriod = visiblePeriods.find((period) => String(period.id) === value)
    setPeriodId(value)
    if (nextPeriod) {
      setStartDate(nextPeriod.start_date)
      setEndDate(nextPeriod.end_date)
    }
    setResult(null)
  }

  async function generateReport() {
    setGenerating(true)
    setError('')
    setResult(null)
    try {
      if (!startDate || !endDate || endDate < startDate) {
        throw new Error('Choose a valid date range to generate this report.')
      }
      const query = `start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
      if (reportType === 'ap' || reportType === 'ar') {
        const [records, settlements] = await Promise.all([
          apiRequest(`/api/modules/${reportType}/records`),
          apiRequest(`/api/modules/${reportType}/settlements`),
        ])
        const reportRows = invoiceReportRows(records, settlements, startDate, endDate)
        setResult({
          columns: [
            { key: 'invoice', label: 'Invoice' }, { key: 'party', label: reportType === 'ap' ? 'Supplier' : 'Customer' },
            { key: 'invoiceDate', label: 'Invoice date' }, { key: 'dueDate', label: 'Due date' },
            { key: 'amountMinor', label: 'Amount' }, { key: 'taxMinor', label: 'Tax' },
            { key: 'invoiceTotalMinor', label: 'Invoice total' }, { key: 'paidMinor', label: 'Paid' },
            { key: 'outstandingMinor', label: 'Outstanding' }, { key: 'status', label: 'Status' },
          ],
          rows: reportRows,
          moneyKeys: ['amountMinor', 'taxMinor', 'invoiceTotalMinor', 'paidMinor', 'outstandingMinor'],
          summaries: [
            { label: 'Invoices', value: reportRows.length },
            { label: 'Invoice total', value: formatMinor(reportRows.reduce((total, row) => total + row.invoiceTotalMinor, 0)) },
            { label: 'Outstanding', value: formatMinor(reportRows.reduce((total, row) => total + row.outstandingMinor, 0)) },
          ],
        })
      } else if (reportType === 'fixed-assets') {
        const records = await apiRequest('/api/modules/fixed-assets/records')
        const reportRows = records.filter((record) => isWithinRange(record.data.acquisition_date, startDate, endDate)).map((record) => ({
          id: record.id,
          asset: record.name,
          assetCode: record.data.asset_code || '—',
          acquisitionDate: record.data.acquisition_date,
          costMinor: Math.round(Number(record.data.cost || 0) * 100),
          usefulLife: record.data.useful_life_years ? `${record.data.useful_life_years} years` : '—',
          status: record.status,
        }))
        setResult({
          columns: [
            { key: 'asset', label: 'Asset' }, { key: 'assetCode', label: 'Asset code' },
            { key: 'acquisitionDate', label: 'Acquisition date' }, { key: 'costMinor', label: 'Cost' },
            { key: 'usefulLife', label: 'Useful life' }, { key: 'status', label: 'Status' },
          ],
          rows: reportRows,
          moneyKeys: ['costMinor'],
          summaries: [
            { label: 'Assets', value: reportRows.length },
            { label: 'Total cost', value: formatMinor(reportRows.reduce((total, row) => total + row.costMinor, 0)) },
          ],
        })
      } else if (reportType === 'budgeting') {
        const budgets = await apiRequest('/api/accounting/budget-variance')
        const reportRows = budgets.filter((row) => row.start_date >= startDate && row.end_date <= endDate)
        setResult({
          columns: [
            { key: 'budget_name', label: 'Budget' }, { key: 'account_code', label: 'Account' },
            { key: 'start_date', label: 'From' }, { key: 'end_date', label: 'To' },
            { key: 'budget_minor', label: 'Budget' }, { key: 'actual_minor', label: 'Actual' },
            { key: 'variance_minor', label: 'Remaining' },
          ],
          rows: reportRows,
          moneyKeys: ['budget_minor', 'actual_minor', 'variance_minor'],
          summaries: [
            { label: 'Budgets', value: reportRows.length },
            { label: 'Budget total', value: formatMinor(reportRows.reduce((total, row) => total + row.budget_minor, 0)) },
            { label: 'Actual total', value: formatMinor(reportRows.reduce((total, row) => total + row.actual_minor, 0)) },
          ],
        })
      } else if (reportType === 'gst') {
        const gstRows = await apiRequest(`/api/accounting/gst-summary?${query}`)
        setResult({
          columns: [
            { key: 'direction', label: 'Direction' }, { key: 'tax_mode', label: 'Treatment' },
            { key: 'rate', label: 'Rate' }, { key: 'invoice_count', label: 'Invoices' },
            { key: 'taxable_minor', label: 'Taxable value' }, { key: 'tax_minor', label: 'Tax' },
          ],
          rows: gstRows.map((row, index) => ({ ...row, id: `${row.direction}-${row.tax_mode}-${row.rate}-${index}` })),
          moneyKeys: ['taxable_minor', 'tax_minor'],
          summaries: [
            { label: 'Taxable value', value: formatMinor(gstRows.reduce((total, row) => total + row.taxable_minor, 0)) },
            { label: 'Total tax', value: formatMinor(gstRows.reduce((total, row) => total + row.tax_minor, 0)) },
          ],
        })
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setGenerating(false)
    }
  }

  function exportReport() {
    if (!result) return
    csvDownload(reportType, columns, rows, startDate, endDate)
  }

  const activeReport = reportTypes.find((type) => type.id === reportType)

  return (
    <section className="financial-reports-page">
      <header className="financial-reports-heading">
        <div><p>FINANCIAL REPORTING</p><h1>Financial Reports</h1><span>Generate reports for posted accounting activity and saved financial statements.</span></div>
      </header>
      <section className="financial-report-builder">
        <div className="financial-report-tabs" role="tablist" aria-label="Report type">
          {reportTypes.map((type) => (
            <button type="button" role="tab" aria-selected={reportType === type.id} className={reportType === type.id ? 'active' : ''} key={type.id} onClick={() => { setReportType(type.id); setResult(null); setError('') }}>
              <span aria-hidden="true">{type.icon === 'Percent' ? '%' : type.icon === 'Landmark' ? '▤' : type.icon === 'ReceiptText' ? '▧' : type.icon === 'ChartNoAxesCombined' ? '⌁' : '▧'}</span>
              {type.label}
            </button>
          ))}
        </div>
        {reportType === 'financial-statement' ? (
          <div className="financial-report-statement"><ModuleInsights moduleId="financial-reports" role={role} /></div>
        ) : (
          <>
            <div className="financial-report-fields">
              <label><span>Company</span><select value={company} onChange={(event) => changeCompany(event.target.value)} disabled={loadingOptions}>
                <option value="all">All Companies</option>
                {companies.map((item) => <option key={item} value={item}>{item}</option>)}
              </select></label>
              <label><span>Fiscal Year</span><select value={fiscalYearId} onChange={(event) => changeFiscalYear(event.target.value)} disabled={loadingOptions || !visibleYears.length}>
                {visibleYears.length
                  ? visibleYears.map((year) => <option key={year.id} value={year.id}>{year.code}</option>)
                  : <option value="">No fiscal years available</option>}
              </select></label>
              <label><span>Fiscal Period</span><select value={periodId} onChange={(event) => changePeriod(event.target.value)} disabled={loadingOptions || !visiblePeriods.length}>
                {visiblePeriods.length
                  ? visiblePeriods.map((period) => <option key={period.id} value={period.id}>{period.name}</option>)
                  : <option value="">No periods available</option>}
              </select></label>
              <label><span>From Date <b>*</b></span><input type="date" required value={startDate} onChange={(event) => { setStartDate(event.target.value); setResult(null) }} /></label>
              <label><span>To Date <b>*</b></span><input type="date" required value={endDate} onChange={(event) => { setEndDate(event.target.value); setResult(null) }} /></label>
              <button className="financial-report-generate" type="button" onClick={generateReport} disabled={loadingOptions || generating || reportType === 'financial-statement'}>
                <span aria-hidden="true">▧</span>{generating ? 'Generating…' : 'Generate Report'}
              </button>
            </div>
            <footer className="financial-report-builder-footer"><span>{activeReport?.label} · {selectedYear?.code || 'Select a fiscal year'}{selectedPeriod ? ` · ${selectedPeriod.name}` : ''}</span>
              {result && <button type="button" className="financial-report-export" onClick={exportReport}>Export CSV</button>}
            </footer>
          </>
        )}
      </section>
      {error && <div className="financial-report-error" role="alert">{error}</div>}
      {result && (
        <section className="financial-report-results" aria-live="polite">
          <header><div><p>GENERATED REPORT</p><h2>{activeReport?.label}</h2><span>{startDate} – {endDate}</span></div></header>
          <div className="financial-report-summary">{result.summaries.map((item) => <article key={item.label}><span>{item.label}</span><b>{item.value}</b></article>)}</div>
          <div className="financial-report-table-wrap"><table className="financial-report-table">
            <thead><tr>{result.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>{result.rows.map((row) => <tr key={row.id ?? row.record_id ?? `${row.account_code}-${row.start_date}`}>
              {result.columns.map((column) => <td key={column.key}>{result.moneyKeys.includes(column.key)
                ? formatMinor(row[column.key])
                : column.key === 'direction'
                  ? row.direction === 'input' ? 'Input (AP)' : 'Output (AR)'
                  : column.key === 'rate' ? `${row[column.key]}%`
                    : column.key === 'account_code' ? `${row.account_code} · ${row.account_name}`
                      : row[column.key] ?? '—'}</td>)}
            </tr>)}
              {!result.rows.length && <tr><td className="financial-report-empty" colSpan={result.columns.length}>No records found for the selected filters.</td></tr>}
            </tbody>
          </table></div>
        </section>
      )}
    </section>
  )
}
