import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { itemFromScrape } from "../lib/items";

// Slide-in panel 
export default function AddDrawer({ open, onClose, onAddSpecific, onCreateGeneral }) {
  const [link, setLink] = useState("");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: "", error: false });
  const linkInput = useRef(null);

  // When the drawer opens, put cursor in the link box
  useEffect(() => {
    if (open) linkInput.current?.focus();
  }, [open]);

  async function addLink() {
    const url = link.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      return setStatus({ text: "Paste the full link, starting with https://", error: true });
    }
    setBusy(true);
    setStatus({ text: "Getting the image, price and tags. This takes about 10 to 20 seconds.", error: false });
    try {
      const data = await api("/api/scrape", { url });
      onAddSpecific(itemFromScrape(data));
      setLink("");
      setStatus({ text: "", error: false });
      onClose();
    } catch (e) {
      setStatus({ text: `Couldn't add this link: ${e.message}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  function addIdea() {
    const title = idea.trim();
    if (!title) return;
    onCreateGeneral(title);
    setIdea("");
    onClose();
  }

  return (
    <div className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="drawer-header">
        <h3 style={{ fontSize: 14, textTransform: "uppercase" }}>ADD ITEM</h3>
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="form-group">
        <label htmlFor="add-link-input">PASTE SPECIFIC ITEM LINK</label>
        <input
          ref={linkInput}
          id="add-link-input"
          type="text"
          placeholder="https://store.com/item-url..."
          value={link}
          onChange={(e) => { setLink(e.target.value); setStatus({ text: "", error: false }); }}
          onKeyDown={(e) => e.key === "Enter" && addLink()}
        />
        <button className="btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={addLink}>
          {busy ? "READING PAGE…" : "ADD LINK ITEM"}
        </button>
        <div className={`status-msg ${status.error ? "error" : ""}`}>{status.text}</div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: "var(--mid-gray)", margin: "20px 0" }}>— OR —</div>

      <div className="form-group">
        <label htmlFor="add-general-input">GENERAL ITEM IDEA</label>
        <textarea
          id="add-general-input"
          rows={3}
          placeholder="describe what you want (e.g. pink shorts, leather trench coat)..."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={addIdea}>
          CREATE GENERAL IDEA
        </button>
        <div className="status-msg">Options from real stores start loading right away. It can take up to a minute.</div>
      </div>
    </div>
  );
}
