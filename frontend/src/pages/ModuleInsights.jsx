import { useEffect, useState } from 'react'
import { apiFetch } from '../api.js'
import './ModuleInsights.css'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })

async function apiRequest(path, options = {}) {
  const response = await apiFetch(path, options)
  const data = response.status === 204 ? null : await response.json()
  if (!response.ok) {
    throw new Error(typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status}).`)
  }
  return data
}

function formatMinor(value) {
  return money.format((Number(value) || 0) / 100)
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function defaultFiscalStart() {
  const now = new Date()
  return `${now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1}-04-01`
}

export default function ModuleInsights({ moduleId, role = 'requester' }) {
  const [data, setData] = useState(null)
  const [savedReports, setSavedReports] = useState([])
  const [reportType, setReportType] = useState('income_statement')
  const [startDate, setStartDate] = useState(defaultFiscalStart)
  const [endDate, setEndDate] = useState(today)
  const [reportName, setReportName] = useState('')
  const [reportNotes, setReportNotes] = useState('')
  const [showReportForm, setShowReportForm] = useState(false)
  const [refreshCount, setRefreshCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canSaveReport = role === 'admin'

  useEffect(() => {
    let cancelled = false
    const path = moduleId === 'budgeting'
      ? '/api/accounting/budget-variance'
      : moduleId === 'gst'
        ? `/api/accounting/gst-summary?start_date=${startDate}&end_date=${endDate}`
        : `/api/accounting/financial-report?report_type=${reportType}&start_date=${startDate}&end_date=${endDate}`
    Promise.all([
      apiRequest(path),
      moduleId === 'financial-reports'
        ? apiRequest('/api/modules/financial-reports/records')
        : Promise.resolve(null),
    ])
      .then(([result, reports]) => {
        if (!cancelled) {
          setData(result)
          if (reports) setSavedReports(reports)
          setError('')
        }
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [moduleId, reportType, startDate, endDate, refreshCount])

  const title = moduleId === 'budgeting'
    ? 'Approved budget vs. actual'
    : moduleId === 'gst'
      ? 'Posted GST summary'
      : 'Generated financial statement'

  function exportCsv() {
    const rows = moduleId === 'budgeting'
      ? [
          ['Budget', 'Account code', 'Account name', 'Start date', 'End date', 'Budget', 'Actual', 'Remaining'],
          ...(data || []).map((row) => [
            row.budget_name,
            row.account_code,
            row.account_name,
            row.start_date,
            row.end_date,
            row.budget_minor / 100,
            row.actual_minor / 100,
            row.variance_minor / 100,
          ]),
        ]
      : moduleId === 'gst'
        ? [
            ['Direction', 'Treatment', 'Rate', 'Invoices', 'Taxable value', 'Tax'],
            ...(data || []).map((row) => [
              row.direction,
              row.tax_mode,
              `${row.rate}%`,
              row.invoice_count,
              row.taxable_minor / 100,
              row.tax_minor / 100,
            ]),
          ]
        : [
            ['Account code', 'Account name', 'Type', 'Balance'],
            ...(data?.lines || []).map((line) => [
              line.account_code,
              line.account_name,
              line.account_type,
              line.amount_minor / 100,
            ]),
          ]
    const csv = `\uFEFF${rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${moduleId}-${startDate}-${endDate}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function saveFinancialReport(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const saved = await apiRequest('/api/accounting/financial-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: reportName.trim(),
          report_type: reportType,
          start_date: reportType === 'income_statement' ? startDate : endDate,
          end_date: endDate,
          notes: reportNotes.trim() || null,
        }),
      })
      setSavedReports((current) => [saved, ...current])
      setReportName('')
      setReportNotes('')
      setShowReportForm(false)
      setNotice(`${saved.name} was saved with a generated report snapshot.`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="insights-panel">
      <header className="insights-heading">
        <div><h2>{title}</h2><p>Reports use posted ledger activity only.</p></div>
        {moduleId === 'financial-reports' && (
          <div className="insights-controls">
            <label><span>Statement</span><select value={reportType} onChange={(event) => setReportType(event.target.value)}><option value="income_statement">Income statement</option><option value="balance_sheet">Balance sheet</option></select></label>
            {reportType === 'income_statement' && <label><span>From</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>}
            <label><span>Through</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
        )}
        {moduleId === 'gst' && (
          <div className="insights-controls">
            <label><span>Invoice date from</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label><span>Through</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
        )}
        <div className="insights-heading-actions">
          {moduleId === 'financial-reports' && canSaveReport && (
            <button className={showReportForm ? 'insights-refresh' : 'form-primary-action'} onClick={() => { setShowReportForm((open) => !open); setError(''); setNotice('') }} disabled={loading || !data}>
              {showReportForm ? 'Cancel save' : 'Save report record'}
            </button>
          )}
          <button className="insights-refresh" onClick={exportCsv} disabled={loading || (moduleId === 'financial-reports' ? !data?.lines?.length : !data?.length)}>Export CSV</button>
        </div>
        <button className="insights-refresh" onClick={() => { setLoading(true); setRefreshCount((count) => count + 1) }} disabled={loading}>Refresh</button>
      </header>
      {error && <div className="insights-error" role="alert">{error}</div>}
      {notice && <div className="insights-notice" role="status">{notice}</div>}
      {moduleId === 'financial-reports' && showReportForm && canSaveReport && (
        <form className="report-record-form" onSubmit={saveFinancialReport}>
          <div className="report-record-form-heading"><h3>Save generated statement</h3><p>The selected statement and date range will be recalculated and saved with a backend snapshot.</p></div>
          <label><span>Report name</span><input value={reportName} onChange={(event) => setReportName(event.target.value)} maxLength={160} required /></label>
          <label className="report-notes-field"><span>Notes</span><textarea value={reportNotes} onChange={(event) => setReportNotes(event.target.value)} maxLength={2000} rows={2} /></label>
          <div className="report-record-context">
            <b>{reportType === 'income_statement' ? 'Income statement' : 'Balance sheet'}</b>
            <span>{reportType === 'income_statement' ? `${startDate} – ${endDate}` : `As of ${endDate}`}</span>
          </div>
          <footer><button type="button" className="insights-refresh" onClick={() => setShowReportForm(false)} disabled={saving}>Cancel</button><button type="submit" className="form-submit" disabled={saving || !reportName.trim()}>{saving ? 'Saving…' : 'Save report'}</button></footer>
        </form>
      )}
      {loading ? <div className="insights-empty">Loading report…</div> : (
        <>
          {moduleId === 'budgeting' && (
            <div className="insights-table-wrap"><table className="insights-table">
              <thead><tr><th>Budget</th><th>Account</th><th>Period</th><th>Budget</th><th>Actual</th><th>Remaining</th></tr></thead>
              <tbody>{data?.map((row) => <tr key={row.record_id}>
                <td>{row.budget_name}</td><td>{row.account_code} · {row.account_name}</td><td>{row.start_date} – {row.end_date}</td>
                <td>{formatMinor(row.budget_minor)}</td><td>{formatMinor(row.actual_minor)}</td><td>{formatMinor(row.variance_minor)}</td>
              </tr>)}
              {!data?.length && <tr><td className="insights-empty" colSpan="6">No approved budgets yet. Create a draft in Budgeting, submit it for approval, then approve it to include it here.</td></tr>}</tbody>
            </table></div>
          )}
          {moduleId === 'gst' && (
            <div className="insights-table-wrap"><table className="insights-table">
              <thead><tr><th>Direction</th><th>Treatment</th><th>Rate</th><th>Invoices</th><th>Taxable value</th><th>Tax</th></tr></thead>
              <tbody>{data?.map((row) => <tr key={`${row.direction}-${row.tax_mode}-${row.rate}`}>
                <td>{row.direction === 'input' ? 'Input (AP)' : 'Output (AR)'}</td><td>{row.tax_mode}</td><td>{row.rate}%</td>
                <td>{row.invoice_count}</td><td>{formatMinor(row.taxable_minor)}</td><td>{formatMinor(row.tax_minor)}</td>
              </tr>)}
              {!data?.length && <tr><td className="insights-empty" colSpan="6">No posted GST invoices in this date range. Configure a tax rate, then submit, approve, and post an AP or AR invoice.</td></tr>}</tbody>
            </table></div>
          )}
          {moduleId === 'financial-reports' && data && (
            <>
              <div className="insights-summary">
                {reportType === 'income_statement' ? <>
                  <span>Income <b>{formatMinor(data.total_income_minor)}</b></span>
                  <span>Expenses <b>{formatMinor(data.total_expenses_minor)}</b></span>
                  <span>Net income <b>{formatMinor(data.net_income_minor)}</b></span>
                </> : <>
                  <span>Assets <b>{formatMinor(data.total_assets_minor)}</b></span>
                  <span>Liabilities <b>{formatMinor(data.total_liabilities_minor)}</b></span>
                  <span>Equity + current earnings <b>{formatMinor(data.total_equity_minor)}</b></span>
                  <span>Balance <b>{data.balanced ? 'Balanced' : 'Out of balance'}</b></span>
                </>}
              </div>
              <div className="insights-table-wrap"><table className="insights-table">
                <thead><tr><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
                <tbody>{data.lines.map((line) => <tr key={line.account_code}><td>{line.account_code} · {line.account_name}</td><td>{line.account_type}</td><td>{formatMinor(line.amount_minor)}</td></tr>)}
                  {!data.lines.length && <tr><td className="insights-empty" colSpan="3">No posted ledger entries in this report period.</td></tr>}
                </tbody>
              </table></div>
            </>
          )}
        </>
      )}
      {moduleId === 'financial-reports' && (
        <section className="saved-reports">
          <header><div><h3>Saved report records</h3><p>Generated snapshots stored in this workspace.</p></div><span>{savedReports.length} saved</span></header>
          <div className="insights-table-wrap"><table className="insights-table saved-reports-table">
            <thead><tr><th>Report</th><th>Statement</th><th>Period</th><th>Generated</th><th>Notes</th><th>Snapshot</th></tr></thead>
            <tbody>{savedReports.map((record) => {
              const snapshot = record.data.snapshot
              const isIncomeStatement = record.data.report_type === 'income_statement'
              return (
                <tr key={record.id}>
                  <td><b>{record.name}</b></td>
                  <td>{isIncomeStatement ? 'Income statement' : 'Balance sheet'}</td>
                  <td>{isIncomeStatement ? `${record.data.start_date} – ${record.data.end_date}` : `As of ${record.data.end_date}`}</td>
                  <td>{record.data.generated_on}</td>
                  <td className="saved-report-notes">{record.data.notes || '—'}</td>
                  <td><details className="saved-report-snapshot">
                    <summary>View snapshot</summary>
                    <div className="saved-report-snapshot-content">
                      {isIncomeStatement ? <>
                        <span>Income <b>{formatMinor(snapshot.total_income_minor)}</b></span>
                        <span>Expenses <b>{formatMinor(snapshot.total_expenses_minor)}</b></span>
                        <span>Net income <b>{formatMinor(snapshot.net_income_minor)}</b></span>
                      </> : <>
                        <span>Assets <b>{formatMinor(snapshot.total_assets_minor)}</b></span>
                        <span>Liabilities <b>{formatMinor(snapshot.total_liabilities_minor)}</b></span>
                        <span>Equity <b>{formatMinor(snapshot.total_equity_minor)}</b></span>
                        <span>Balance <b>{snapshot.balanced ? 'Balanced' : 'Out of balance'}</b></span>
                      </>}
                      <div>{snapshot.lines.map((line) => <p key={line.account_code}>{line.account_code} · {line.account_name}: {formatMinor(line.amount_minor)}</p>)}</div>
                    </div>
                  </details></td>
                </tr>
              )
            })}
            {!savedReports.length && <tr><td className="insights-empty" colSpan="6">No saved report records yet. Generate a statement above, then save it to this workspace.</td></tr>}</tbody>
          </table></div>
          {!canSaveReport && <p className="saved-reports-permission">Only workspace admins can save report records.</p>}
        </section>
      )}
      <p className="insights-disclaimer">Management MVP only: verify tax and statement treatment with your accountant before relying on these figures.</p>
    </section>
  )
}
