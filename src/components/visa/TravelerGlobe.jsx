import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Live rotating globe for the homepage hero. Golden dots represent travelers
// leaving India and arcing out to destinations across the world. No flight
// routes are drawn — just glowing gold dots traveling along great-circle arcs.
// Stylized (no earth texture): a dotted navy sphere with a fine wireframe and a
// warm orange rim, tuned to match the Krosz hero palette.

// [name, lat, lng] — a handful of real destinations Indian travelers go to.
const DESTINATIONS = [
  ['Dubai', 25.2, 55.27], ['Bangkok', 13.75, 100.5], ['Hanoi', 21.03, 105.85],
  ['Bali', -8.34, 115.09], ['Kuala Lumpur', 3.14, 101.69], ['Singapore', 1.35, 103.82],
  ['Istanbul', 41.01, 28.98], ['Colombo', 6.93, 79.86], ['London', 51.51, -0.13],
  ['Riyadh', 24.71, 46.68], ['Nairobi', -1.29, 36.82], ['Tokyo', 35.68, 139.69],
  ['New York', 40.71, -74.0], ['Sydney', -33.87, 151.21],
];
const ORIGIN = [20.59, 78.96]; // India

function latLngToVec3(lat, lng, r) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

export default function TravelerGlobe() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const R = 2;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 6.6);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const globe = new THREE.Group();
    scene.add(globe);

    // Solid core — deep navy, slightly translucent.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 48),
      new THREE.MeshPhongMaterial({ color: 0x0b1527, shininess: 18, transparent: true, opacity: 0.96 }),
    );
    globe.add(core);

    // Dotted surface — many tiny points for a "data-globe" texture.
    const dotCount = 1800;
    const dotPos = new Float32Array(dotCount * 3);
    for (let i = 0; i < dotCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const rr = R + 0.005;
      dotPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
      dotPos[i * 3 + 1] = rr * Math.cos(phi);
      dotPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    globe.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: 0x6a7891, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.55,
    })));

    // Fine wireframe overlay for longitude/latitude feel.
    globe.add(new THREE.Mesh(
      new THREE.IcosahedronGeometry(R + 0.004, 4),
      new THREE.MeshBasicMaterial({ color: 0x006cec, wireframe: true, transparent: true, opacity: 0.1 }),
    ));

    // Destination pins — glowing gold dots.
    const gold = new THREE.MeshBasicMaterial({ color: 0x006cec });
    const pinGeo = new THREE.SphereGeometry(0.028, 12, 12);
    const destVecs = DESTINATIONS.map(([name, lat, lng]) => {
      const v = latLngToVec3(lat, lng, R + 0.01);
      const m = new THREE.Mesh(pinGeo, gold);
      m.position.copy(v);
      globe.add(m);
      return v.clone();
    });

    // Origin — India, slightly larger and brighter.
    const originVec = latLngToVec3(ORIGIN[0], ORIGIN[1], R + 0.012);
    const origin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), new THREE.MeshBasicMaterial({ color: 0x003580 }));
    origin.position.copy(originVec);
    globe.add(origin);

    function pickDest() { return destVecs[Math.floor(Math.random() * destVecs.length)].clone(); }

    // Traveling dots — golden arcs from India to random destinations.
    const TRAVELERS = 14;
    const travelers = Array.from({ length: TRAVELERS }, () => {
      const t = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), new THREE.MeshBasicMaterial({ color: 0x006cec }));
      globe.add(t);
      return { mesh: t, start: originVec.clone(), end: pickDest(), t: Math.random(), speed: 0.0024 + Math.random() * 0.0026, arcH: 0.35 + Math.random() * 0.5 };
    });

    // Lights — soft key + warm rim.
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 0.6); key.position.set(5, 3, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x006cec, 0.5); rim.position.set(-6, -2, -3); scene.add(rim);

    // Tilt the globe a touch (like Earth's axial tilt) for visual interest.
    globe.rotation.x = 0.45;
    globe.rotation.z = 0.12;

    let raf;
    const tick = () => {
      globe.rotation.y += 0.0022;
      for (const tr of travelers) {
        tr.t += tr.speed;
        if (tr.t >= 1) { tr.t = 0; tr.end = pickDest(); tr.start = originVec.clone(); tr.arcH = 0.35 + Math.random() * 0.5; }
        tr.mesh.position.copy(
          tr.start.clone().lerp(tr.end, tr.t).normalize().multiplyScalar(R + Math.sin(Math.PI * tr.t) * tr.arcH)
        );
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize); ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.dispose(); dotGeo.dispose(); pinGeo.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="h-full w-full" aria-hidden />;
}