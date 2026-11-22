import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createServer } from "vite";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");

function createSessionManager({
  signIn = async () => {
    throw new Error("not used");
  },
  signUp = async () => {
    throw new Error("not used");
  },
  verifyRegistrationLink = async () => { throw new Error("not used"); },
  resendVerification = async () => {
    throw new Error("not used");
  },
  requestPasswordReset = async () => {
    throw new Error("not used");
  },
  checkConnectivity = async () => ({ ok: true, status: 200, ms: 42, reason: "" }),
}) {
  let snapshot = {
    status: "anonymous",
    session: null,
    user: null,
    companionId: null,
    error: null,
  };
  const listeners = new Set();

  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener({ ...snapshot }));
  }

  return {
    getSnapshot: () => ({ ...snapshot }),
    isConfigured: () => true,
    initialize: async () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRequestContext: async () => ({}),
    signUp: (payload) => signUp({ payload, publish }),
    signIn: (payload) => signIn({ payload, publish }),
    resendVerification: (payload) =>
      resendVerification({ payload, publish }),
    verifyRegistrationLink,
    requestPasswordReset: (payload) =>
      requestPasswordReset({ payload, publish }),
    checkConnectivity: (options) => checkConnectivity(options),
  };
}

function textContent(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children || []).map(textContent).join("");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderGate(AuthGate, sessionManager) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        AuthGate,
        { sessionManager },
        React.createElement("div", null, "authenticated"),
      ),
    );
  });
  return renderer;
}

const vite = await createServer({
  root: projectRoot,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});

try {
  const { AuthScreen, default: AuthGate } =
    await vite.ssrLoadModule("/src/AuthGate.jsx");

  {
    let verifiedLink;
    const manager = createSessionManager({
      async verifyRegistrationLink(link) { verifiedLink = link; throw new Error("虚构链接已失效"); },
    });
    const renderer = await renderGate(AuthGate, manager);
    await act(async () => renderer.root.find(node => node.type === "input" && node.props.type === "email").props.onChange({ target: { value: "retry@example.test" } }));
    await act(async () => renderer.root.find(node => node.type === "button" && textContent(node).includes("验证链接失效")).props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => true }) } } }));
    const input = renderer.root.find(node => node.type === "input" && node.props.placeholder === "粘贴邮件中确认按钮的原始链接");
    assert.equal(input.props.type, "password");
    await act(async () => input.props.onChange({ target: { value: "fictional-link" } }));
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }));
    assert.equal(verifiedLink, "fictional-link");
    assert.equal(renderer.root.findByType("input").props.value, "");
    assert.match(textContent(renderer.toJSON()), /虚构链接已失效/);
    await act(async () => renderer.unmount());
  }

  {
    const manager = createSessionManager({});
    const renderer = await renderGate(AuthGate, manager);
    const emailInput = renderer.root.find(node => node.type === "input" && node.props.type === "email");
    const passwordInput = renderer.root.find(node => node.type === "input" && node.props.type === "password");
    assert.equal(emailInput.props.autoComplete, "email");
    assert.equal(emailInput.props.autoCorrect, "off");
    assert.equal(emailInput.props.spellCheck, false);
    assert.equal(emailInput.props.enterKeyHint, "next");
    assert.equal(passwordInput.props.autoComplete, "current-password");
    assert.equal(passwordInput.props.autoCorrect, "off");
    assert.equal(passwordInput.props.spellCheck, false);
    assert.equal(passwordInput.props.enterKeyHint, "go");
    await act(async () => renderer.unmount());
  }

  {
    let resendPayload;
    const manager = createSessionManager({
      async resendVerification({ payload }) { resendPayload = payload; },
    });
    const renderer = await renderGate(AuthGate, manager);
    const emailInput = renderer.root.find(node => node.type === "input" && node.props.type === "email");
    await act(async () => emailInput.props.onChange({ target: { value: "retry@example.test" } }));
    const retry = renderer.root.find(node => node.type === "button" && textContent(node).includes("验证链接失效"));
    await act(async () => retry.props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => false }) } } }));
    assert.equal(renderer.root.findAll(node => node.props.className === "auth-verification").length, 0);
    await act(async () => retry.props.onClick({ currentTarget: { form: { querySelector: () => ({ reportValidity: () => true }) } } }));
    assert.match(textContent(renderer.toJSON()), /retry@example.test/);
    assert.equal(resendPayload, undefined, "opening retry does not send an email");
    await act(async () => renderer.root.find(node => node.type === "button" && textContent(node) === "重新发送验证邮件").props.onClick());
    assert.equal(resendPayload.email, "retry@example.test");
    assert.equal(resendPayload.emailRedirectTo, "https://www.dengtahome.com/");
    await act(async () => renderer.unmount());
  }

  {
    const signUpResponse = deferred();
    let signUpPayload;
    let resendPayload;
    const manager = createSessionManager({
      async signUp({ payload, publish }) {
        signUpPayload = payload;
        publish({ status: "authenticating", error: null });
        await signUpResponse.promise;
        publish({ status: "anonymous", error: null });
        return { emailVerificationRequired: true };
      },
      async resendVerification({ payload }) {
        resendPayload = payload;
      },
    });
    const renderer = await renderGate(AuthGate, manager);

    const tabs = renderer.root.findAll(
      (node) => node.type === "button" && node.props.role === "tab",
    );
    assert.equal(tabs.length, 2);
    await act(async () => tabs[1].props.onClick());

    const inputs = renderer.root.findAll((node) => node.type === "input");
    const nameInput = inputs.find((node) => node.props.type === "text");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInputs = inputs.filter((node) => node.props.type === "password");
    assert.equal(passwordInputs.length, 2, "registration must ask for the password twice");
    await act(async () => {
      nameInput.props.onChange({ target: { value: "桃桃" } });
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInputs[0].props.onChange({ target: { value: "example-password" } });
      passwordInputs[1].props.onChange({ target: { value: "example-password" } });
    });

    const form = renderer.root.findByType("form");
    let submitPromise;
    await act(async () => {
      submitPromise = form.props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
    });

    const pendingInputs = renderer.root.findAll(
      (node) => node.type === "input",
    );
    assert.equal(
      pendingInputs.find((node) => node.props.type === "email")?.props.value,
      "taotao@example.test",
      "registration fields must survive the intermediate authenticating state",
    );

    signUpResponse.resolve();
    await act(async () => {
      await submitPromise;
    });

    const verificationPanels = renderer.root.findAll(
      (node) => node.props.className === "auth-verification",
    );
    assert.equal(
      verificationPanels.length,
      1,
      "registration must remain on the verification result when auth status changes",
    );
    assert.match(textContent(renderer.toJSON()), /taotao@example\.test/);
    assert.equal(
      signUpPayload.emailRedirectTo,
      "https://www.dengtahome.com/",
      "signup must pass the resolved public callback",
    );

    const resendButton = renderer.root.find(
      (node) =>
        node.type === "button" &&
        /秒后可重新发送/.test(textContent(node)),
    );
    assert.equal(
      resendButton.props.disabled,
      true,
      "the email just sent by signup must not be re-sent immediately",
    );
    assert.match(textContent(resendButton), /^60 秒后可重新发送$/);
    await act(async () => resendButton.props.onClick());
    assert.equal(
      resendPayload,
      undefined,
      "a cooled-down resend must not reach the auth service",
    );
    await act(async () => renderer.unmount());
  }

  {
    let signInCalls = 0;
    const pendingSignIn = deferred();
    const manager = createSessionManager({
      async signIn({ publish }) {
        signInCalls += 1;
        publish({ status: "authenticating", error: null });
        await pendingSignIn.promise;
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const inputs = renderer.root.findAll((node) => node.type === "input");
    await act(async () => {
      inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "double@example.test" } });
      inputs.find((node) => node.props.type === "password").props.onChange({ target: { value: "example-password" } });
    });
    const form = renderer.root.findByType("form");
    await act(async () => {
      form.props.onSubmit({ preventDefault() {} });
      form.props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
    });
    assert.equal(signInCalls, 1, "one form submit must produce one sign-in request");
    pendingSignIn.resolve();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => renderer.unmount());
  }

  {
    const offlineDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let signInCalls = 0;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    try {
      const manager = createSessionManager({
        async signIn() { signInCalls += 1; },
      });
      const renderer = await renderGate(AuthGate, manager);
      const inputs = renderer.root.findAll((node) => node.type === "input");
      await act(async () => {
        inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "offline@example.test" } });
        inputs.find((node) => node.props.type === "password").props.onChange({ target: { value: "example-password" } });
      });
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
      });
      assert.equal(signInCalls, 0, "an offline device must not call the auth service");
      assert.match(textContent(renderer.toJSON()), /没有网络连接/);
      await act(async () => renderer.unmount());
    } finally {
      if (offlineDescriptor) Object.defineProperty(globalThis, "navigator", offlineDescriptor);
      else delete globalThis.navigator;
    }
  }

  {
    let resendCalls = 0;
    const manager = createSessionManager({
      async signIn() {
        const error = new Error("邮箱尚未验证。请打开最新的验证邮件。");
        error.code = "email_not_confirmed";
        throw error;
      },
      async resendVerification() { resendCalls += 1; },
    });
    const renderer = await renderGate(AuthGate, manager);
    const inputs = renderer.root.findAll((node) => node.type === "input");
    await act(async () => {
      inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "unverified@example.test" } });
      inputs.find((node) => node.props.type === "password").props.onChange({ target: { value: "example-password" } });
    });
    await act(async () => {
      await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    const action = renderer.root.find(
      (node) => node.type === "button" && textContent(node).includes("去发送验证邮件"),
    );
    await act(async () => action.props.onClick());
    assert.match(textContent(renderer.toJSON()), /unverified@example\.test/);
    assert.equal(
      resendCalls,
      0,
      "opening the verification panel must not send an email by itself",
    );
    await act(async () => renderer.unmount());
  }

  {
    let resetPayload;
    const manager = createSessionManager({
      async requestPasswordReset({ payload }) {
        resetPayload = payload;
      },
    });
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(AuthScreen, {
          sessionManager: manager,
          initialMode: "forgot",
        }),
      );
    });
    const emailInput = renderer.root.find(
      (node) => node.type === "input" && node.props.type === "email",
    );
    await act(async () => {
      emailInput.props.onChange({ target: { value: "reset@example.test" } });
    });
    await act(async () => {
      await renderer.root
        .findByType("form")
        .props.onSubmit({ preventDefault() {} });
    });
    assert.equal(
      resetPayload.redirectTo,
      "https://www.dengtahome.com/",
      "password reset must use the resolved callback",
    );
    await act(async () => renderer.unmount());
  }

  {
    const expectedError = "测试登录失败，请重新检查邮箱或密码。";
    const manager = createSessionManager({
      async signUp() {
        throw new Error("not used");
      },
      async signIn({ publish }) {
        publish({ status: "authenticating", error: null });
        await Promise.resolve();
        const error = new Error(expectedError);
        publish({ status: "anonymous", error });
        throw error;
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const inputs = renderer.root.findAll((node) => node.type === "input");
    const emailInput = inputs.find((node) => node.props.type === "email");
    const passwordInput = inputs.find((node) => node.props.type === "password");
    await act(async () => {
      emailInput.props.onChange({ target: { value: "taotao@example.test" } });
      passwordInput.props.onChange({ target: { value: "wrong-password" } });
    });

    const form = renderer.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault() {} });
    });

    assert.match(
      textContent(renderer.toJSON()),
      new RegExp(expectedError),
      "a failed sign-in must keep a visible error instead of silently clearing the form",
    );
    await act(async () => renderer.unmount());
  }

  {
    const manager = createSessionManager({
      async signUp() {
        return { emailVerificationRequired: false, existingAccount: true, user: null, session: null };
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    await act(async () => {
      renderer.root.findAll((node) => node.type === "button" && node.props.role === "tab")[1].props.onClick();
    });
    const inputs = renderer.root.findAll((node) => node.type === "input");
    await act(async () => {
      inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "existing@example.test" } });
      inputs.filter((node) => node.props.type === "password")[0].props.onChange({ target: { value: "example-password" } });
      inputs.filter((node) => node.props.type === "password")[1].props.onChange({ target: { value: "example-password" } });
    });
    await act(async () => {
      await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    const body = textContent(renderer.toJSON());
    assert.match(body, /这个邮箱已经注册过/, "an obfuscated existing account must be reported honestly");
    assert.doesNotMatch(body, /验证邮件已经发出/, "an existing account must not claim a new email was sent");
    assert.equal(
      renderer.root.find((node) => node.type === "input" && node.props.type === "email").props.value,
      "existing@example.test",
      "the email must stay filled for the login step",
    );
    assert.equal(
      renderer.root.findAll((node) => node.props.className === "auth-verification").length,
      0,
      "existing accounts belong on the login form, not the verification panel",
    );
    const action = renderer.root.find(
      (node) => node.type === "button" && textContent(node).includes("去发送验证邮件"),
    );
    await act(async () => action.props.onClick());
    assert.match(textContent(renderer.toJSON()), /existing@example\.test/);
    await act(async () => renderer.unmount());
  }

  {
    const manager = createSessionManager({
      async signUp() {
        return { emailVerificationRequired: false, emailConfirmed: true, existingAccount: false, user: null, session: null };
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    await act(async () => {
      renderer.root.findAll((node) => node.type === "button" && node.props.role === "tab")[1].props.onClick();
    });
    const inputs = renderer.root.findAll((node) => node.type === "input");
    await act(async () => {
      inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "confirmed@example.test" } });
      inputs.filter((node) => node.props.type === "password")[0].props.onChange({ target: { value: "example-password" } });
      inputs.filter((node) => node.props.type === "password")[1].props.onChange({ target: { value: "example-password" } });
    });
    await act(async () => {
      await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    const body = textContent(renderer.toJSON());
    assert.match(body, /注册成功，邮箱已验证/, "auto-confirmed signup must not pretend a verification email was sent");
    assert.doesNotMatch(body, /验证邮件已经发出/, "auto-confirmed signup has no verification mail");
    assert.equal(renderer.root.findAll((node) => node.props.className === "auth-verification").length, 0);
    assert.equal(
      renderer.root.find((node) => node.type === "input" && node.props.type === "email").props.value,
      "confirmed@example.test",
      "the confirmed email must stay filled for the login step",
    );
    await act(async () => renderer.unmount());
  }

  {
    let connectivityCalls = 0;
    const manager = createSessionManager({
      async checkConnectivity() {
        connectivityCalls += 1;
        return { ok: true, status: 200, ms: 128, reason: "" };
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const check = renderer.root.find(
      (node) => node.type === "button" && textContent(node).includes("检测登录服务是否可达"),
    );
    await act(async () => check.props.onClick());
    assert.equal(connectivityCalls, 1);
    assert.match(textContent(renderer.toJSON()), /登录服务可访问（128 ms）/);
    await act(async () => renderer.unmount());
  }

  {
    const manager = createSessionManager({
      async checkConnectivity() {
        return { ok: false, status: 0, ms: 8001, reason: "timeout" };
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    const check = renderer.root.find(
      (node) => node.type === "button" && textContent(node).includes("检测登录服务是否可达"),
    );
    await act(async () => check.props.onClick());
    assert.match(textContent(renderer.toJSON()), /检测超时/);
    assert.match(textContent(renderer.toJSON()), /网络加速/);
    await act(async () => renderer.unmount());
  }

  {
    const manager = createSessionManager({
      async signUp() {
        return { emailVerificationRequired: true, existingAccount: false, user: null, session: null };
      },
    });
    const renderer = await renderGate(AuthGate, manager);
    await act(async () => {
      renderer.root.findAll((node) => node.type === "button" && node.props.role === "tab")[1].props.onClick();
    });
    const inputs = renderer.root.findAll((node) => node.type === "input");
    await act(async () => {
      inputs.find((node) => node.props.type === "email").props.onChange({ target: { value: "mismatch@example.test" } });
      inputs.filter((node) => node.props.type === "password")[0].props.onChange({ target: { value: "example-password" } });
      inputs.filter((node) => node.props.type === "password")[1].props.onChange({ target: { value: "different-password" } });
    });
    let signUpCalls = 0;
    manager.signUp = async () => { signUpCalls += 1; return { emailVerificationRequired: true }; };
    await act(async () => {
      await renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    assert.equal(signUpCalls, 0, "mismatched passwords must not reach the auth service");
    assert.match(textContent(renderer.toJSON()), /两次输入的密码不一致/);
    await act(async () => renderer.unmount());
  }
} finally {
  await vite.close();
}

console.log("AuthGate component state regression tests passed");
