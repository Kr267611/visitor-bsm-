import type { AdminDevice } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage, useApi } from '../api';
import { PageHeader } from '../ui/Page';

function RevokeAction({ device }: { device: AdminDevice }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setError(null);
    try {
      await api.admin.devices.revoke(device.id);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'devices'] });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (device.revokedAt) return <span className="badge badge-neutral">Blocked</span>;
  return (
    <div className="row">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}>
          Block karein
        </button>
      ) : (
        <>
          <button type="button" className="danger" onClick={() => void revoke()}>
            Haan, block karein
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Nahi
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}

export function DevicesPanel() {
  const api = useApi();
  const devices = useQuery({ queryKey: ['admin', 'devices'], queryFn: () => api.admin.devices.list() });
  return (
    <>
      <PageHeader title="Devices" subtitle="Jin phones aur browsers se log login hain. Phone kho jaye to yahan se block karein; access turant band ho jata hai." />
      {devices.isError && (
        <p role="alert" className="error">
          {errorMessage(devices.error)}
        </p>
      )}
      <section className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>User</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {devices.data?.map((device) => (
              <tr key={device.id}>
                <td>{device.name}</td>
                <td>
                  {device.user.name} ({device.user.role})
                </td>
                <td>
                  <RevokeAction device={device} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
