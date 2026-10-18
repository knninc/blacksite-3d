"use client";

import { useEffect, useRef, useState } from "react";

export default function Game3DClient() {
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    let mount: ((root: HTMLElement) => () => void) | undefined;
    const start = () => {
      if (!cancelled && root.current && mount) {
        dispose?.();
        dispose = mount(root.current);
      }
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) start(); };
    window.addEventListener("pageshow", restore);
    void import("../src/three/game").then(({ mountBlacksite3D }) => {
      mount = mountBlacksite3D;
      start();
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; window.removeEventListener("pageshow", restore); dispose?.(); };
  }, []);
  return <>
    <div id="blacksite-three" className="blacksite3d" ref={root} />
    {error && <p role="alert" style={{ position: "fixed", inset: "35% 12%", color: "#eee", zIndex: 100 }}>
      3D画面を読み込めませんでした。ページを再読み込みするか、<a href="/classic">2D版を開いてください</a>。
    </p>}
  </>;
}
