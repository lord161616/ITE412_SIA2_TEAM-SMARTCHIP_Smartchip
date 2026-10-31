import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { SHOP_LIMITS } from "../../config/constants";
import useAction from "../../hooks/useAction";
import { formatGrams, formatPeso } from "../../lib/format";
import { batchGrams, createListing, updateListing } from "../../services/shopService";
import Modal from "../ui/Modal";
import { Notice } from "../ui/States";

const DEFAULT_PACKAGES = [
  { grams: "50", price: "" },
  { grams: "100", price: "" },
];

/** Publish a Dried batch, or edit an existing listing. */
export default function ListingModal({ batch, product, onClose }) {
  const editing = Boolean(product);
  const maxGrams = batchGrams(batch);
  const held = editing ? product.listedGrams - product.availableGrams : 0;

  const [form, setForm] = useState(() => ({
    name: product?.name ?? "Dried oyster mushrooms",
    description: product?.description ?? "",
    listedGrams: String(product?.listedGrams ?? maxGrams),
    packages: product?.packages.map((p) => ({ grams: String(p.grams), price: String(p.price) })) ?? DEFAULT_PACKAGES,
    published: product?.published ?? true,
  }));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setPkg = (i, key) => (e) =>
    setForm((f) => ({ ...f, packages: f.packages.map((p, j) => (j === i ? { ...p, [key]: e.target.value } : p)) }));

  const [save, saving] = useAction(
    (data) => (editing ? updateListing(product.id, batch, data) : createListing(batch, data)),
    {
      success: editing ? "Listing saved." : form.published ? "Published to the storefront." : "Listing saved (hidden).",
      onSuccess: onClose,
    },
  );

  const toSave = {
    ...form,
    packages: form.packages,
    listedGrams: Number(form.listedGrams),
  };

  return (
    <Modal
      open
      size="lg"
      title={editing ? `Edit listing · ${batch.batchNumber}` : `Publish batch ${batch.batchNumber}`}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="listing-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save" : form.published ? "Publish" : "Save hidden"}
          </button>
        </>
      }
    >
      <form
        id="listing-form"
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault();
          save(toSave);
        }}
      >
        <Notice tone="info">
          Dried weight of this batch: <strong>{formatGrams(maxGrams)}</strong>
          {held > 0 && (
            <>
              {" "}· already reserved or sold: <strong>{formatGrams(held)}</strong>
            </>
          )}
        </Notice>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="listing-name">Product name</label>
            <input id="listing-name" className="input" value={form.name} onChange={set("name")} maxLength={80} required />
          </div>
          <div className="field">
            <label htmlFor="listing-grams">Amount for sale (grams)</label>
            <input
              id="listing-grams"
              className="input"
              type="number"
              min={Math.max(1, held)}
              max={maxGrams}
              step={1}
              value={form.listedGrams}
              onChange={set("listedGrams")}
              required
            />
            <div className="field-hint">Keep some back for your own use by entering less than {formatGrams(maxGrams)}.</div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="listing-desc">Description (optional)</label>
          <textarea
            id="listing-desc"
            className="input"
            rows={2}
            value={form.description}
            onChange={set("description")}
            maxLength={500}
            placeholder="e.g. Crispy, sun-golden oyster mushrooms. Great for soups and adobo."
          />
        </div>

        <fieldset className="field">
          <legend>Package sizes and prices</legend>
          <div className="package-editor">
            {form.packages.map((p, i) => (
              <div key={i} className="package-row">
                <div className="input-suffix">
                  <input
                    className="input"
                    type="number"
                    min={SHOP_LIMITS.minPackageGrams}
                    step={1}
                    value={p.grams}
                    onChange={setPkg(i, "grams")}
                    aria-label={`Package ${i + 1} size in grams`}
                    required
                  />
                  <span>g</span>
                </div>
                <div className="input-prefix">
                  <span>₱</span>
                  <input
                    className="input"
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={p.price}
                    onChange={setPkg(i, "price")}
                    aria-label={`Package ${i + 1} price in pesos`}
                    required
                  />
                </div>
                <span className="muted fine-print">
                  {Number(p.grams) > 0 && Number(p.price) > 0 ? `${formatPeso((Number(p.price) / Number(p.grams)) * 100)} / 100 g` : ""}
                </span>
                {form.packages.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Remove package"
                    onClick={() => setForm((f) => ({ ...f, packages: f.packages.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {form.packages.length < SHOP_LIMITS.maxPackages && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setForm((f) => ({ ...f, packages: [...f.packages, { grams: "", price: "" }] }))}
            >
              <Plus size={14} /> Add a size
            </button>
          )}
        </fieldset>

        <label className="check">
          <input
            type="checkbox"
            checked={form.published}
            onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))}
          />
          Show on the storefront
        </label>
      </form>
    </Modal>
  );
}
