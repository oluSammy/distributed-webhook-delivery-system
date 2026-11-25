import { RotateSecret } from "./RotateSecret";

// The Secrets tab: what the signing secret is for, and rotating it.
export function SecretsPanel({ endpointId }: { endpointId: string }) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <p className="text-fg-2">
        Every webhook is signed with this endpoint's secret, so the receiver can tell it's really
        from us. Secrets are only shown once, when they're made, so none is shown here.
      </p>
      <p className="text-fg-2">
        Rotate it if it may have leaked, or as routine. For 24 hours, each webhook is signed with
        both the old and the new secret: update the receiver to the new one within that time.
      </p>
      <RotateSecret endpointId={endpointId} />
    </div>
  );
}
