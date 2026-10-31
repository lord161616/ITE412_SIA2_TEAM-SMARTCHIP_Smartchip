import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PAYMENT, RESERVATION } from "../config/constants";
import { getErrorMessage } from "../lib/errors";
import { reservationCode, subscribeToAllReservations } from "../services/shopService";
import { useAuth } from "./AuthContext";
import { useFeedback } from "./FeedbackContext";

const ShopContext = createContext(null);

/**
 * Shop manager's live reservation feed, shared by the sidebar badge and the
 * Manage shop tab. While a manager has the app open (any page), a new
 * reservation or a submitted GCash payment pops up a toast.
 */
export function ShopProvider({ children }) {
  const { canOperate, user } = useAuth();
  const { toast } = useFeedback();
  const [feed, setFeed] = useState({ uid: null, reservations: [], loading: true, error: null });
  const seen = useRef(null); // id -> paymentStatus, from the previous snapshot

  useEffect(() => {
    if (!canOperate || !user) return undefined;
    const uid = user.uid;
    seen.current = null;
    return subscribeToAllReservations(
      (list) => {
        const previous = seen.current;
        if (previous) {
          list.forEach((r) => {
            if (!previous.has(r.id) && r.status === RESERVATION.RESERVED) {
              toast.info(`New order ${reservationCode(r.id)} from ${r.customerName}. Check their GCash payment.`);
            } else if (previous.get(r.id) !== PAYMENT.SUBMITTED && r.paymentStatus === PAYMENT.SUBMITTED) {
              toast.info(`${r.customerName} sent a GCash payment for ${reservationCode(r.id)}. Please verify it.`);
            }
          });
        }
        seen.current = new Map(list.map((r) => [r.id, r.paymentStatus]));
        setFeed({ uid, reservations: list, loading: false, error: null });
      },
      (error) => {
        console.error(error);
        setFeed({ uid, reservations: [], loading: false, error: getErrorMessage(error) });
      },
    );
  }, [canOperate, user, toast]);

  const value = useMemo(() => {
    const mine = canOperate && user && feed.uid === user.uid;
    const reservations = mine ? feed.reservations : [];
    const open = reservations.filter((r) => [RESERVATION.RESERVED, RESERVATION.READY].includes(r.status));
    return {
      enabled: Boolean(canOperate),
      reservations,
      loading: mine ? feed.loading : Boolean(canOperate),
      error: mine ? feed.error : null,
      /** Needs the manager: GCash payments to check + paid orders to prepare. */
      todoCount: open.filter(
        (r) =>
          r.paymentStatus === PAYMENT.SUBMITTED ||
          (r.status === RESERVATION.RESERVED && r.paymentStatus === PAYMENT.VERIFIED),
      ).length,
    };
  }, [canOperate, user, feed]);

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const context = useContext(ShopContext);
  if (!context) throw new Error("useShop must be used inside <ShopProvider>");
  return context;
}
