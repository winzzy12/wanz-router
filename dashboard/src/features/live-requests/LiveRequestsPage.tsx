import { useMemo, useState, type ReactNode } from "react";
import { Activity, Eye, EyeOff, Zap } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { DataTable } from "../../components/ui/layout";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/state";
import { Inline } from "../../components/ui/inline";
import { Stack } from "../../components/ui/stack";
import { useMaskIp } from "../../lib/privacy-mode";
import { useProviders } from "../../hooks/providers";
import { useUsageRequests } from "../../hooks/system";
import { InFlightProvider, LiveInFlightPill } from "../usage/sections/in-flight";
import { RequestDetailDrawer } from "../usage/sections/request-detail-drawer";
import { RequestRow } from "../usage/sections/requests-table";

/** How often the feed re-reads, in milliseconds. The page contract is 1 second. */
const LIVE_REFRESH_MS = 1_000;

/** The shortest usage period: keeps the window small so the feed stays "live". */
const LIVE_PERIOD = "1h";

type SortKey = "startedAt" | "status" | "tokens" | "duration";

/**
 * Live Requests — a near-real-time feed of the most recent gateway requests.
 *
 * Reuses the Usage page's requests query and row/detail components, but with a
 * one-second refetch interval instead of the default live cadence, so a busy
 * gateway reads like a ticker rather than a snapshot. The in-flight pill is the
 * same SSE-backed gauge the Usage page shows, so one glance gives both "what is
 * running now" and "what just finished".
 */
export default function LiveRequests(): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { enabled: maskIpEnabled, setEnabled: setMaskIpEnabled } = useMaskIp();
  const providersQuery = useProviders();
  const providerNames = useMemo(
    () => new Map((providersQuery.data ?? []).map((provider) => [provider.providerId, provider.label || provider.displayName])),
    [providersQuery.data],
  );

  const [sortKey, setSortKey] = useState<SortKey>("startedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey): void => {
    setSortKey((current) => {
      if (current !== key) {
        setSortDirection("desc");
        return key;
      }
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return current;
    });
  };

  // `limit` is generous but bounded: the feed should stay readable while still
  // surfacing every request that completed within the refresh window.
  const requestsQuery = useUsageRequests(LIVE_PERIOD, 100, null, LIVE_REFRESH_MS);

  const rows = useMemo(() => {
    const items = [...(requestsQuery.data?.items ?? [])];
    const direction = sortDirection === "asc" ? 1 : -1;
    const numeric = (value: number | undefined): number => (typeof value === "number" && Number.isFinite(value) ? value : -1);
    items.sort((left, right) => {
      switch (sortKey) {
        case "status":
          return ((left.httpStatus ?? 0) - (right.httpStatus ?? 0)) * direction
            || left.startedAt.localeCompare(right.startedAt) * -1;
        case "tokens":
          return (((left.totalTokens ?? 0) - (right.totalTokens ?? 0)) * direction)
            || left.startedAt.localeCompare(right.startedAt) * -1;
        case "duration":
          return ((numeric(left.durationMs) - numeric(right.durationMs)) * direction)
            || left.startedAt.localeCompare(right.startedAt) * -1;
        case "startedAt":
        default:
          return left.startedAt.localeCompare(right.startedAt) * direction;
      }
    });
    return items;
  }, [requestsQuery.data?.items, sortKey, sortDirection]);

  return (
    <InFlightProvider>
      <Stack gap="16px">
        <Card>
          <CardHeader
            title="Live Requests"
            subtitle="Real-time feed of recent requests · refreshed every second"
            icon={<Zap size={16} />}
            action={
              <Inline gap="12px" align="center" className="flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={maskIpEnabled ? <EyeOff size={13} /> : <Eye size={13} />}
                  onClick={() => setMaskIpEnabled(!maskIpEnabled)}
                  title={maskIpEnabled ? "Show client addresses" : "Hide client addresses"}
                  className="text-badge h-13 px-4 py-0 text-text-secondary"
                >
                  {maskIpEnabled ? "IP masked" : "Mask IP"}
                </Button>
                <LiveInFlightPill />
              </Inline>
            }
          />
          <CardBody className="p-0">
            {requestsQuery.isPending && rows.length === 0 ? (
              <LoadingState compact label="Loading live requests…" />
            ) : requestsQuery.isError && rows.length === 0 ? (
              <ErrorState compact message="Could not load the live request feed." onRetry={() => void requestsQuery.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState
                compact
                title="No requests yet"
                message="Route requests through the gateway to populate the live feed."
                icon={<Activity size={20} />}
              />
            ) : (
              <div className="rounded-control border border-inner-border bg-surface-1">
                <DataTable
                  maxHeight={560}
                  headers={[
                    { key: "startedAt", label: "Time", sortable: true },
                    { key: "model", label: "Provider/model" },
                    { key: "apiKey", label: "API Key" },
                    { key: "status", label: "Status", sortable: true },
                    { key: "tokens", label: "Tokens", sortable: true },
                    { key: "duration", label: "Done", sortable: true },
                  ]}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={(key) => toggleSort(key as SortKey)}
                >
                  {rows.map((row) => (
                    <RequestRow
                      key={row.requestId}
                      row={row}
                      hideProviderName={false}
                      maskIpEnabled={maskIpEnabled}
                      providerNames={providerNames}
                      isNew={false}
                      onSelect={() => setSelectedId(row.requestId)}
                    />
                  ))}
                </DataTable>
              </div>
            )}
          </CardBody>
        </Card>

        <RequestDetailDrawer requestId={selectedId} onClose={() => setSelectedId(null)} />
      </Stack>
    </InFlightProvider>
  );
}
