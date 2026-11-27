import * as THREE from 'three';
import { BallPhysics, ease } from './interaction-controller.js';

export class InteractionProps {
  constructor(scene, pet) {
    this.pet = pet;
    this.ballPhysics = new BallPhysics();
    this.lastSerial = -1;
    this.ballHit = false;
    this.presence = { foodBowl: 0, waterBowl: 0, brush: 0 };
    this.group = new THREE.Group();
    scene.add(this.group);

    const stdMat = (c, opts = {}) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.04, ...opts });

    // 1. Glossy striped interactive toy ball (larger & thumb-friendly for drag/fling!)
    const ballRadius = this.ballPhysics.radius;
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(ballRadius, 30, 20),
      new THREE.MeshPhysicalMaterial({
        color: 0xff7b6b,
        roughness: 0.22,
        clearcoat: 0.9,
        clearcoatRoughness: 0.14,
      }),
    );
    this.ball.castShadow = true;
    this.ball.name = 'Interactive_ball';
    this.group.add(this.ball);

    const stripeA = new THREE.Mesh(
      new THREE.TorusGeometry(ballRadius * 1.006, 0.0038, 8, 44),
      stdMat(0xfff1c4, { roughness: 0.3 }),
    );
    this.ball.add(stripeA);
    const stripeB = new THREE.Mesh(
      new THREE.TorusGeometry(ballRadius * 1.006, 0.0032, 8, 44),
      stdMat(0x7be0c3, { roughness: 0.3 }),
    );
    stripeB.rotation.y = Math.PI / 2;
    this.ball.add(stripeB);

    // Ball floor shadow so 3D bounce height reads instantly!
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(ballRadius * 1.15, 24),
      new THREE.MeshBasicMaterial({ color: 0x161214, transparent: true, opacity: 0.36, depthWrite: false }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.003;
    this.group.add(this.ballShadow);

    // 2. Real 3D Dog Food Bowl + Golden Kibble Nuggets + Cute Mini Bone Biscuit (`feed`)
    this.foodBowl = new THREE.Group();
    this.foodBowl.name = 'Cotton_Food_Bowl';
    const bowlOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.082, 0.042, 32, 1, false),
      stdMat(0xf48c7f, { roughness: 0.36 }),
    );
    bowlOuter.position.y = 0.021;
    this.foodBowl.add(bowlOuter);
    const bowlInner = new THREE.Mesh(
      new THREE.CircleGeometry(0.061, 28),
      stdMat(0x523124, { roughness: 0.8 }),
    );
    bowlInner.rotation.x = -Math.PI / 2;
    bowlInner.position.y = 0.036;
    this.foodBowl.add(bowlInner);
    const bowlRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.067, 0.0045, 10, 36),
      stdMat(0xffd2c7, { roughness: 0.3 }),
    );
    bowlRim.rotation.x = Math.PI / 2;
    bowlRim.position.y = 0.042;
    this.foodBowl.add(bowlRim);

    this.kibbles = [];
    const kibbleMat = stdMat(0xc57d41, { roughness: 0.72 });
    const kibbleOffsets = [
      [0, 0.043, 0], [-0.022, 0.042, 0.014], [0.022, 0.042, 0.012],
      [-0.016, 0.042, -0.018], [0.018, 0.042, -0.016], [0, 0.044, 0.026],
      [-0.032, 0.041, -0.004], [0.031, 0.041, 0.004], [0, 0.045, -0.008],
    ];
    for (const [kx, ky, kz] of kibbleOffsets) {
      const nugget = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), kibbleMat.clone());
      nugget.scale.set(1.1, 0.72, 0.95);
      nugget.position.set(kx, ky, kz);
      this.foodBowl.add(nugget);
      this.kibbles.push(nugget);
    }
    // Cute golden biscuit bone on top of the kibble
    const boneGroup = new THREE.Group();
    const boneMat = stdMat(0xf4c77b, { roughness: 0.62 });
    const boneShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.034, 10), boneMat);
    boneShaft.rotation.z = Math.PI / 2;
    boneGroup.add(boneShaft);
    for (const sx of [-0.017, 0.017]) {
      for (const sz of [-0.005, 0.005]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), boneMat);
        knob.position.set(sx, 0, sz);
        boneGroup.add(knob);
      }
    }
    boneGroup.position.set(0, 0.052, 0.006);
    boneGroup.rotation.y = 0.35;
    this.foodBowl.add(boneGroup);
    this.boneTreat = boneGroup;
    this.foodBowl.visible = false;
    this.group.add(this.foodBowl);

    // 3. Real 3D Sky-Blue Water Bowl + Animated Water Surface & Ripples (`drink`)
    this.waterBowl = new THREE.Group();
    this.waterBowl.name = 'Cotton_Water_Bowl';
    const wOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.082, 0.042, 32, 1, false),
      stdMat(0x7ac3d8, { roughness: 0.32 }),
    );
    wOuter.position.y = 0.021;
    this.waterBowl.add(wOuter);
    const wRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.067, 0.0045, 10, 36),
      stdMat(0xd5f2fa, { roughness: 0.25 }),
    );
    wRim.rotation.x = Math.PI / 2;
    wRim.position.y = 0.042;
    this.waterBowl.add(wRim);
    this.waterSurface = new THREE.Mesh(
      new THREE.CircleGeometry(0.062, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0x6dd4f2,
        transparent: true,
        opacity: 0.82,
        roughness: 0.12,
        clearcoat: 1,
      }),
    );
    this.waterSurface.rotation.x = -Math.PI / 2;
    this.waterSurface.position.y = 0.038;
    this.waterBowl.add(this.waterSurface);
    this.waterRipple = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.018, 28),
      new THREE.MeshBasicMaterial({ color: 0xe6fbff, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    this.waterRipple.rotation.x = -Math.PI / 2;
    this.waterRipple.position.y = 0.04;
    this.waterBowl.add(this.waterRipple);
    this.waterBowl.visible = false;
    this.group.add(this.waterBowl);

    // 4. Cute Pastel Grooming Brush (`brush`)
    this.brush = new THREE.Group();
    this.brush.name = 'Cotton_Groom_Brush';
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.052, 6, 12), stdMat(0xeaa878, { roughness: 0.42 }));
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.036;
    this.brush.add(handle);
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.032, 18, 12), stdMat(0xffa7b2, { roughness: 0.45 }));
    pad.scale.set(0.95, 0.36, 1.2);
    this.brush.add(pad);
    const bristleMat = stdMat(0xfff4e4, { roughness: 0.6 });
    for (let ix = -2; ix <= 2; ix += 1) {
      for (let iz = -2; iz <= 2; iz += 1) {
        const bristle = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.014, 6), bristleMat);
        bristle.position.set(ix * 0.0085, -0.012, iz * 0.01);
        this.brush.add(bristle);
      }
    }
    this.brush.visible = false;
    this.group.add(this.brush);

    // 5. Adorable Visible Coral Collar + Shiny Golden Bell on Cotton's neck!
    this.collarGroup = new THREE.Group();
    this.collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.106, 0.011, 10, 48),
      stdMat(0xe86b7a, { roughness: 0.42 }),
    );
    this.collar.rotation.x = Math.PI / 2;
    this.collarGroup.add(this.collar);
    this.bell = new THREE.Mesh(
      new THREE.SphereGeometry(0.017, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffcf56, roughness: 0.22, metalness: 0.72 }),
    );
    this.bell.position.set(0, -0.012, 0.112);
    this.collarGroup.add(this.bell);
    const bellRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.0165, 0.0022, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0xd99b26, roughness: 0.3, metalness: 0.6 }),
    );
    bellRing.rotation.x = Math.PI / 2;
    bellRing.position.copy(this.bell.position);
    this.collarGroup.add(bellRing);
    this.collarGroup.position.copy(new THREE.Vector3(0, 0.295, 0.065).sub(pet.rest.neck));
    pet.named.neck.add(this.collarGroup);
    this.collarGroup.visible = true;

    // Preserve legacy aliases
    this.hand = this.foodBowl;
    this.cup = this.waterBowl;
    this.frame = new THREE.Group();
    this.frame.visible = false;
    this.photo = new THREE.Mesh(new THREE.PlaneGeometry(0.122, 0.142), stdMat(0xe6dfc8));
    this.frame.add(this.photo);
    this.group.add(this.frame);
  }

  setPhoto(texture) {
    this.photo.material.map?.dispose();
    this.photo.material.map = texture;
    this.photo.material.needsUpdate = true;
    this.frame.visible = true;
  }

  update(dt, controller) {
    const { id, serial } = controller.active;
    const age = controller.age;
    const e = controller.envelope;
    if (serial !== this.lastSerial) {
      this.lastSerial = serial;
      this.ballHit = false;
      this.ballStart = { ...this.ballPhysics.position };
    }

    const reachTarget = ease(age / 0.85) * (1 - ease((age - 5.1) / 0.85));
    for (const [key, activeId] of [
      ['foodBowl', 'feed'],
      ['waterBowl', 'drink'],
      ['brush', 'brush'],
    ]) {
      const target = id === activeId ? (key === 'brush' ? e : reachTarget) : 0;
      this.presence[key] += (target - this.presence[key]) * (1 - Math.exp(-12 * dt));
      const visible = this.presence[key] > 0.01;
      this[key].visible = visible;
      if (visible) {
        const s = 0.55 + 0.45 * this.presence[key];
        this[key].scale.setScalar(s);
      }
    }

    // Place bowls right in front of Cotton's current position & facing direction!
    const heading = this.pet.locomotion?.heading || 0;
    const px = this.pet.locomotion?.x || 0;
    const pz = this.pet.locomotion?.z || 0;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);

    if (this.foodBowl.visible) {
      this.foodBowl.position.set(px + fx * 0.25, 0, pz + fz * 0.25);
      // Gradually eat kibble pieces & bone as age progresses!
      const eatProgress = id === 'feed' ? THREE.MathUtils.clamp((age - 0.8) / 3.8, 0, 1) : 0;
      const eatenCount = Math.floor(eatProgress * this.kibbles.length);
      this.kibbles.forEach((nugget, idx) => {
        nugget.visible = idx >= eatenCount;
      });
      if (this.boneTreat) {
        this.boneTreat.visible = eatProgress < 0.72;
        this.boneTreat.rotation.z = Math.sin(age * 14) * 0.08;
      }
    }

    if (this.waterBowl.visible) {
      this.waterBowl.position.set(px + fx * 0.25, 0, pz + fz * 0.25);
      const drinkProgress = id === 'drink' ? THREE.MathUtils.clamp((age - 0.7) / 3.8, 0, 1) : 0;
      this.waterSurface.position.y = 0.038 - drinkProgress * 0.008;
      const ripplePhase = (age * 2.4) % 1;
      const rScale = 0.65 + ripplePhase * 2.4;
      this.waterRipple.scale.set(rScale, rScale, 1);
      this.waterRipple.material.opacity = (1 - ripplePhase) * 0.82 * this.presence.waterBowl;
    }

    if (this.brush.visible) {
      const headTop = this.pet.named.head.localToWorld(
        new THREE.Vector3(Math.sin(age * 5.2) * 0.055, 0.125 + Math.cos(age * 5.2) * 0.012, 0.02),
      );
      this.brush.position.copy(headTop);
      this.brush.rotation.set(0.18, heading, Math.sin(age * 5.2) * 0.34);
    }

    // Subtle bell jingle sway with movement
    if (this.bell) {
      const moveAmt = Math.min(1, (this.pet.locomotion?.speed || 0) * 3 + (id === 'dance' ? 0.9 : 0.15));
      this.bell.position.x = Math.sin(this.pet.time * 12) * 0.008 * moveAmt;
    }

    // Ball physics + automated playful bat during 'ball' command
    if (id === 'ball' && age < 0.95 && !this.ballPhysics.held) {
      const t = ease(age / 0.95);
      const targetX = px + fx * 0.22 + fz * 0.06;
      const targetZ = pz + fz * 0.22 - fx * 0.06;
      this.ballPhysics.position = {
        x: this.ballStart.x + (targetX - this.ballStart.x) * t,
        y: this.ballPhysics.radius,
        z: this.ballStart.z + (targetZ - this.ballStart.z) * t,
      };
      this.ballPhysics.velocity = { x: 0, y: 0, z: 0 };
    } else {
      if (id === 'ball' && age >= 0.95 && !this.ballHit && !this.ballPhysics.held) {
        const kickSign = Math.sin(this.pet.time * 3.7) >= 0 ? 1 : -1;
        this.ballPhysics.impulse(kickSign * 0.72 + fx * 0.35, 0.82, fz * 0.55);
        this.ballHit = true;
      }
      this.ballPhysics.update(dt);
    }

    this.ball.position.set(
      this.ballPhysics.position.x,
      this.ballPhysics.position.y,
      this.ballPhysics.position.z,
    );
    this.ball.rotation.x += (this.ballPhysics.velocity.z * dt) / this.ballPhysics.radius;
    this.ball.rotation.z -= (this.ballPhysics.velocity.x * dt) / this.ballPhysics.radius;

    // Grounded ball shadow scales gently with height
    const heightAboveFloor = Math.max(0, this.ballPhysics.position.y - this.ballPhysics.radius);
    const shadowScale = Math.max(0.42, 1 - heightAboveFloor * 1.4);
    this.ballShadow.position.set(this.ballPhysics.position.x, 0.003, this.ballPhysics.position.z);
    this.ballShadow.scale.setScalar(shadowScale);
    this.ballShadow.material.opacity = 0.38 * shadowScale;
  }
}
