import { useEffect, useRef } from "react";

export default function CastInviteQr({ value = "", size = 132 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return undefined;
    let active = true;
    import("qrcode")
      .then(({ default: QRCode }) => {
        if (!active) return;
        return QRCode.toCanvas(canvas, value, {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#10131c", light: "#ffffff" },
        });
      })
      .catch(() => {
        // QR is an optional share aid; the invite code/link still works.
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  if (!value) return null;
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="cast-invite-qr"
      role="img"
      aria-label="放映厅邀请二维码"
    />
  );
}
