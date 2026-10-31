import { useEffect, useState } from "react";
import { getErrorMessage } from "../lib/errors";

/**
 * Subscribes to a live Firestore listener for the life of the component.
 *
 *   const { data, loading, error } = useLiveData(subscribeToInventory);
 *
 * `subscribe(onData, onError)` must return an unsubscribe function. Pass a
 * stable function (module-level), or `null` to skip subscribing.
 */
export default function useLiveData(subscribe, initialValue = []) {
  const [state, setState] = useState({ data: initialValue, loading: Boolean(subscribe), error: null });

  useEffect(() => {
    if (!subscribe) return undefined;
    return subscribe(
      (data) => setState({ data, loading: false, error: null }),
      (error) => {
        console.error(error);
        setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(error) }));
      },
    );
  }, [subscribe]);

  return state;
}
