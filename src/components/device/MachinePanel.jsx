import { CirclePlay, Flame, LifeBuoy, ShieldAlert, Square, Undo2, Wind } from "lucide-react";
import { Link } from "react-router-dom";
import { COMMANDS, COMMAND_SLOW_MS, CONNECTION, MACHINE, RECOVERY_AFTER_MS, RUN } from "../../config/constants";
import { useAuth } from "../../context/AuthContext";
import { useDevice } from "../../context/DeviceContext";
import useAction from "../../hooks/useAction";
import { formatAgo, formatClock, formatDateTime, formatMinutes, formatTemp, formatTime } from "../../lib/format";
import { cancelStart, clearFault, getRunProgress, recoverMachine, stopDryingRun } from "../../services/dryingService";
import { Card, InfoGrid, ProgressBar } from "../ui/Card";
import { Notice } from "../ui/States";
import StatusBadge from "../ui/StatusBadge";

/**
 * The machine's current job and every action that applies to it. Used on
 * both the Dashboard and Drying control, so this logic lives in one place.
 * `idleContent` is shown when the machine is free (e.g. the start form).
 */
export default function MachinePanel({ idleContent = null }) {
  const { user, canOperate } = useAuth();
  const { connection, online, device, activeRun, now } = useDevice();
  const uid = user?.uid;

  const [stop, stopping] = useAction((runId) => stopDryingRun({ runId, uid }), {
    confirm: {
      title: "Stop this drying run?",
      message: "The ESP32 turns the heater and fan off straight away and the batch goes back to Fresh.",
      confirmLabel: "Stop drying",
      danger: true,
    },
    success: "STOP sent. Waiting for the ESP32…",
  });
  const [resetFault, resettingFault] = useAction(() => clearFault({ uid }), {
    success: "Clear-fault sent. If the problem is still there, the ESP32 will fault again.",
  });
  const [cancel, cancelling] = useAction(cancelStart, {
    confirm: {
      title: "Cancel this START?",
      message: "The ESP32 hasn't accepted it yet. The run is cancelled and the batch goes back to Fresh.",
      confirmLabel: "Cancel START",
    },
    success: "START cancelled.",
  });
  const [recover, recovering] = useAction(recoverMachine, {
    confirm: {
      title: "Recover the machine?",
      message: (
        <>
          <p>
            The ESP32 isn't responding, so this only cleans up Firestore: the run is marked failed, the batch goes
            back to Fresh and the machine is shown as idle.
          </p>
          <p>
            <strong>First make sure the heater is physically off</strong> (unplug the dehydrator if unsure). If the
            ESP32 comes back later, it will also fail the old run by itself.
          </p>
        </>
      ),
      confirmLabel: "The heater is off — recover",
      danger: true,
    },
    success: "Recovered. The machine is idle in Firestore.",
  });

  if (connection === CONNECTION.LOADING) return null;
  if (!device) {
    return (
      <Card title="Machine">
        <Notice tone="info" title="Waiting for the ESP32">
          The ESP32 creates its Firestore document the first time it connects. See SETUP.md.
        </Notice>
      </Card>
    );
  }

  const { status, pendingCommand, commandResult } = device;
  const silentMs = device.lastSeen ? now - device.lastSeen.getTime() : Infinity;
  const busy = Boolean(device.runId || pendingCommand || [MACHINE.PREHEATING, MACHINE.DRYING].includes(status));

  // Show a rejection for 10 minutes after the command was sent.
  const recentResult = commandResult?.at && now - commandResult.at.getTime() < 10 * 60_000;
  const rejection =
    recentResult && !commandResult.ok ? (
      <Notice tone="error" title={`The ESP32 rejected ${commandResult.type}`}>
        Reason: {commandResult.message}.
      </Notice>
    ) : null;

  /* ---------- Offline in the middle of something ---------- */
  if (!online && busy && !(pendingCommand?.type === COMMANDS.START && !device.runId)) {
    const canRecover = silentMs >= RECOVERY_AFTER_MS;
    return (
      <Card title="Machine not responding" className="machine-panel">
        <Notice tone="warning" title="The ESP32 went offline during a job">
          Last heartbeat {formatAgo(device.lastSeen, now)}. If it comes back, it carries on or fails the run safely
          by itself. If it doesn't, recover the machine here.
        </Notice>
        {activeRun && <RunDetails run={activeRun} device={device} now={now} online={false} />}
        {canOperate && (
          <div className="button-row">
            <button type="button" className="btn btn-danger" onClick={() => recover()} disabled={!canRecover || recovering}>
              <LifeBuoy size={16} /> {recovering ? "Recovering…" : "Recover machine"}
            </button>
          </div>
        )}
        {!canRecover && (
          <p className="fine-print">
            Recovery unlocks after 2 minutes without a heartbeat ({Math.ceil((RECOVERY_AFTER_MS - silentMs) / 1000)} s).
          </p>
        )}
      </Card>
    );
  }

  /* ---------- START sent, not accepted yet ---------- */
  if (pendingCommand?.type === COMMANDS.START && !device.runId) {
    const waited = pendingCommand.requestedAt ? now - pendingCommand.requestedAt.getTime() : 0;
    return (
      <Card title={`Starting ${activeRun?.batchNumber ?? "run"}`} actions={<StatusBadge status="pending" />}>
        <Notice tone={waited > COMMAND_SLOW_MS || !online ? "warning" : "info"}>
          START sent {formatAgo(pendingCommand.requestedAt, now)}. Waiting for the ESP32 to accept it…
          {!online && " The ESP32 is offline. It will reject this START if it arrives more than 2 minutes late."}
        </Notice>
        <InfoGrid
          items={[
            { label: "Target", value: formatTemp(pendingCommand.targetTemp, 0) },
            { label: "Drying time", value: formatMinutes(pendingCommand.durationMinutes) },
          ]}
        />
        {canOperate && (
          <div className="button-row">
            <button type="button" className="btn btn-ghost" onClick={() => cancel()} disabled={cancelling}>
              <Undo2 size={16} /> {cancelling ? "Cancelling…" : "Cancel START"}
            </button>
          </div>
        )}
      </Card>
    );
  }

  /* ---------- Fault ---------- */
  if (status === MACHINE.FAULT) {
    const clearPending = pendingCommand?.type === COMMANDS.CLEAR_FAULT;
    return (
      <Card title="Machine fault" className="machine-panel" actions={<StatusBadge status="fault" />}>
        <Notice tone="error" title={device.fault?.code || "Fault"}>
          {device.fault?.message} The heater has been switched off.
        </Notice>
        {rejection}
        <p className="fine-print">Fix the cause, then clear the fault here or press STOP on the machine.</p>
        {canOperate && (
          <div className="button-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => resetFault()}
              disabled={resettingFault || clearPending || !online}
            >
              <ShieldAlert size={16} /> {clearPending ? "Waiting for the ESP32…" : "Clear fault"}
            </button>
          </div>
        )}
      </Card>
    );
  }

  /* ---------- Running ---------- */
  if (device.runId) {
    const stopPending = pendingCommand?.type === COMMANDS.STOP;
    return (
      <Card
        title={activeRun?.batchNumber ? `Batch ${activeRun.batchNumber}` : "Local run"}
        subtitle={device.source === "local" ? "Started with the buttons on the machine" : "Current drying run"}
        actions={<StatusBadge status={status} />}
        className="machine-panel"
      >
        {stopPending && <Notice tone="info">STOP sent {formatAgo(pendingCommand.requestedAt, now)}. Waiting for the ESP32…</Notice>}
        {rejection}
        {activeRun ? <RunDetails run={activeRun} device={device} now={now} online={online} /> : <p className="muted">Loading run…</p>}
        {canOperate && (
          <div className="button-row">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => stop(device.runId)}
              disabled={stopping || stopPending || !online}
            >
              <Square size={16} /> {stopPending ? "Stopping…" : "Stop drying"}
            </button>
          </div>
        )}
      </Card>
    );
  }

  /* ---------- Free (idle / completed / LCD menu) ---------- */
  const inMenu = status === MACHINE.SETUP;
  return (
    <Card
      title={idleContent ? "Start a drying run" : "Machine"}
      subtitle={!online ? "Device offline" : inMenu ? "Someone is using the machine's menu" : "The dehydrator is free"}
      actions={<StatusBadge status={status || "idle"} />}
    >
      {status === MACHINE.COMPLETED && (
        <Notice tone="success" title="The last run finished">
          Weigh the dried batch and record it on the <Link to="/inventory">Inventory</Link> page.
        </Notice>
      )}
      {inMenu && (
        <Notice tone="info">
          The machine's LCD menu is open, so it will reject a START from the app. Press STOP on the machine to leave
          the menu.
        </Notice>
      )}
      {rejection}
      {idleContent ??
        (canOperate ? (
          <div className="idle-cta">
            <p className="muted">Pick a Fresh batch to start drying.</p>
            <Link to="/scheduler" className="btn btn-primary">
              <CirclePlay size={16} /> Start a drying run
            </Link>
          </div>
        ) : (
          <p className="muted">No drying run in progress.</p>
        ))}
    </Card>
  );
}

function RunDetails({ run, device, now, online }) {
  const progress = getRunProgress(run, now, device.remainingSeconds);
  const lastKnown = online ? "" : " (last known)";
  const preheating = progress.phase === "preheating" || run.status === RUN.PENDING;

  return (
    <div className="run-details">
      <div className="run-progress">
        <div className="run-progress-top">
          {preheating ? (
            <span className="run-remaining is-waiting">
              Preheating to {formatTemp(run.targetTemp, 0)} — the timer starts when it gets there
            </span>
          ) : (
            <span className="run-remaining">{formatClock(progress.remainingSeconds)}</span>
          )}
          {!preheating && <span className="muted">{Math.round(progress.percent)}% done</span>}
        </div>
        <ProgressBar percent={progress.percent} label="Drying progress" />
        {progress.endsAt && <div className="fine-print">Expected to finish at {formatTime(progress.endsAt)}</div>}
      </div>

      <InfoGrid
        items={[
          { label: "Target", value: formatTemp(run.targetTemp, 0) },
          { label: `Chamber${lastKnown || " now"}`, value: formatTemp(device.temperature) },
          { label: "Drying time", value: formatMinutes(run.durationMinutes) },
          { label: "Heater on since", value: formatDateTime(run.startedAt) },
          {
            label: `Heater${lastKnown}`,
            value: (
              <span className="inline-icon">
                <Flame size={14} /> {device.heaterOn ? "ON" : "OFF"}
              </span>
            ),
          },
          {
            label: `Fan${lastKnown}`,
            value: (
              <span className="inline-icon">
                <Wind size={14} /> {device.heaterOn ? "ON" : "OFF"}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
