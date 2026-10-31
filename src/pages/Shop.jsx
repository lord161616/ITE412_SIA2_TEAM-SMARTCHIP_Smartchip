import { useSearchParams } from "react-router-dom";
import ShopManager from "../components/shop/ShopManager";
import Storefront from "../components/shop/Storefront";
import { useAuth } from "../context/AuthContext";
import { useShop } from "../context/ShopContext";
import useLiveData from "../hooks/useLiveData";
import { EMPTY_SETTINGS, subscribeToShopSettings } from "../services/shopService";

/**
 * /shop — everyone sees the Storefront. Shop managers (operators and
 * administrators) also get a "Manage shop" tab (/shop?tab=manage).
 */
export default function Shop() {
  const { canOperate } = useAuth();
  const { todoCount } = useShop();
  const { data: settings } = useLiveData(subscribeToShopSettings, EMPTY_SETTINGS);
  const [params, setParams] = useSearchParams();
  const tab = canOperate && params.get("tab") === "manage" ? "manage" : "store";

  return (
    <div className="page shop">
      {canOperate && (
        <div className="segmented shop-tabs" role="tablist" aria-label="Shop view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "store"}
            className={tab === "store" ? "is-active" : ""}
            onClick={() => setParams({}, { replace: true })}
          >
            Storefront (what customers see)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "manage"}
            className={tab === "manage" ? "is-active" : ""}
            onClick={() => setParams({ tab: "manage" }, { replace: true })}
          >
            Manage shop
            {todoCount > 0 && <span className="count count-alert">{todoCount}</span>}
          </button>
        </div>
      )}
      {tab === "manage" ? <ShopManager settings={settings} /> : <Storefront settings={settings} />}
    </div>
  );
}
