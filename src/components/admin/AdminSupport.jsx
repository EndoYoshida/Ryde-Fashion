import React, { useState } from "react";
import { Check, ChevronDown, ChevronUp, Send, MailWarning } from "lucide-react";
import * as api from "../../api";

export default function AdminSupport({ tickets, resolveTicket, refreshTicket }) {
  const open = tickets.filter((t) => t.status === "open");
  const resolved = tickets.filter((t) => t.status === "resolved");
  const [expanded, setExpanded] = useState(null);

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Customer service</p>
          <h1>Support Tickets</h1>
        </div>
      </div>

      <h3 className="admin-section-label">Open ({open.length})</h3>
      {open.length === 0 ? (
        <p className="admin-empty">No open tickets — nice and quiet.</p>
      ) : (
        <div className="admin-ticket-list">
          {open.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              expanded={expanded === t.id}
              onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
              onResolve={() => resolveTicket(t.id)}
              refreshTicket={refreshTicket}
            />
          ))}
        </div>
      )}

      <h3 className="admin-section-label" style={{ marginTop: 32 }}>Resolved ({resolved.length})</h3>
      <div className="admin-ticket-list">
        {resolved.map((t) => (
          <TicketCard
            key={t.id}
            ticket={t}
            resolved
            expanded={expanded === t.id}
            onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
            refreshTicket={refreshTicket}
          />
        ))}
      </div>
    </div>
  );
}

function TicketCard({ ticket, resolved, expanded, onToggle, onResolve, refreshTicket }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setWarning("");
    try {
      const result = await api.replyToTicketApi(ticket.id, reply.trim());
      refreshTicket(result.ticket);
      setReply("");
      if (!result.emailSent) {
        setWarning(`Saved, but the email wasn't sent: ${result.emailWarning || "email isn't configured yet."}`);
      }
    } catch (err) {
      setWarning(err.message || "Couldn't send that reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`admin-ticket-card ${resolved ? "resolved" : ""}`}>
      <div className="admin-ticket-head">
        <div>
          <strong>{ticket.subject}</strong>
          <span className="admin-mini-sub"> &middot; {ticket.id} &middot; {ticket.date}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {resolved ? (
            <span className="status-badge inline badge-ok">resolved</span>
          ) : (
            <button className="btn-outline small" onClick={onResolve}>
              <Check size={13} /> Mark resolved
            </button>
          )}
          <button className="admin-icon-btn" onClick={onToggle} aria-label={expanded ? "Collapse" : "Expand"}>
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>
      <p className="admin-ticket-from">{ticket.customer} &lt;{ticket.email}&gt;</p>

      {expanded && (
        <>
          <p className="admin-ticket-message">{ticket.message}</p>

          {ticket.replies?.length > 0 && (
            <div className="admin-reply-thread">
              {ticket.replies.map((r) => (
                <div className="admin-reply-bubble" key={r.id}>
                  <p>{r.body}</p>
                  <span className="admin-mini-sub">
                    {new Date(r.createdAt).toLocaleString()}
                    {!r.emailSent && (
                      <> &middot; <MailWarning size={11} style={{ verticalAlign: "-2px" }} /> not emailed</>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          <form className="admin-reply-form" onSubmit={handleReply}>
            <textarea
              placeholder={`Reply to ${ticket.customer}...`}
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            {warning && <p className="admin-field-hint" style={{ color: "#9B4646" }}>{warning}</p>}
            <button type="submit" className="btn-gold small" disabled={busy || !reply.trim()}>
              <Send size={13} /> {busy ? "Sending..." : "Send Reply"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
