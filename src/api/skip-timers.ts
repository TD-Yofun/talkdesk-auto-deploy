/**
 * Skip Wait Timers — DOM-based, 3 sequential approaches + MutationObserver
 */
import { esc } from '../utils/helpers';

type LogFn = (msg: string, level?: string) => void;

/**
 * Observe DOM for "Start all waiting jobs" button appearance.
 * Fires `onDetected` immediately when the button is found (either already
 * present or dynamically added).  Returns a disconnect function.
 */
export function observeSkipButton(onDetected: () => void): () => void {
  const check = (el: HTMLElement): boolean =>
    /start all waiting/i.test(el.textContent || '');

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (check(node as HTMLElement)) {
          onDetected();
          return;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Check if button already exists in the current DOM
  const existing = document.querySelectorAll<HTMLElement>('button, [role="button"], summary');
  for (const btn of existing) {
    if (check(btn)) {
      onDetected();
      break;
    }
  }

  return () => observer.disconnect();
}

export async function trySkipWaitTimers(owner: string, repo: string, addLog: LogFn, skipInitialDelay = false): Promise<boolean> {
  try {
    await new Promise((r) => setTimeout(r, skipInitialDelay ? 300 : 2000));

    // DEBUG: dump relevant DOM elements
    const allForms = [...document.querySelectorAll('form')];
    const skipForms = allForms.filter((f) => {
      const a = f.getAttribute('action') || '';
      return a.includes('environment') || a.includes('skip');
    });
    addLog(`[skip-debug] Forms total: ${allForms.length}, skip-related: ${skipForms.length}`);
    skipForms.forEach((f) =>
      addLog(`[skip-debug]   form action="${f.getAttribute('action')}"`)
    );

    const allBtns = [...document.querySelectorAll<HTMLElement>('button, [role="button"], summary, a.btn')];
    const relevantBtns = allBtns.filter((b) =>
      /start|skip|waiting|timer|deploy|approve|consequence/i.test(b.textContent || '')
    );
    addLog(`[skip-debug] Relevant buttons: ${relevantBtns.length}`);
    relevantBtns.forEach((b) =>
      addLog(`[skip-debug]   <${b.tagName.toLowerCase()}> "${(b.textContent || '').trim().slice(0, 80)}"`)
    );

    const gateInputs = document.querySelectorAll<HTMLInputElement>('input[name="gate_request[]"]');
    addLog(`[skip-debug] gate_request[] inputs: ${gateInputs.length}`);
    gateInputs.forEach((i) => addLog(`[skip-debug]   value="${i.value}"`));

    // Approach 1: click "Start all waiting jobs" button
    for (const btn of allBtns) {
      const text = (btn.textContent || '').trim();
      if (/start all waiting/i.test(text)) {
        addLog(`[skip] Approach 1: clicking "${text}"`);
        btn.click();

        let dialog: HTMLElement | null = null;
        for (let i = 0; i < 10; i++) {
          dialog = document.querySelector('#gates-break-glass-dialog[open], dialog[open].js-gates-dialog');
          if (dialog) break;
          await new Promise((r) => setTimeout(r, 500));
        }

        if (!dialog) {
          addLog('[skip] Approach 1: dialog did not appear after clicking button', 'warn');
          break;
        }
        addLog(`[skip]   dialog found: #${dialog.id}`);

        const checkboxes = dialog.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"][name="gate_request[]"], input.js-gates-dialog-environment-checkbox'
        );
        addLog(`[skip]   checkboxes found: ${checkboxes.length}`);
        checkboxes.forEach((cb) => {
          if (!cb.checked) {
            cb.click();
            addLog(`[skip]   checked: ${cb.value} (${cb.id})`);
          } else {
            addLog(`[skip]   already checked: ${cb.value}`);
          }
        });

        if (checkboxes.length === 0) {
          addLog('[skip] Approach 1: no checkboxes found in dialog', 'warn');
          break;
        }

        await new Promise((r) => setTimeout(r, 300));

        const submitBtn = dialog.querySelector<HTMLButtonElement>(
          'button[type="submit"], button.btn-danger, button[data-target="break-glass-deployments"]'
        );
        if (submitBtn) {
          const st = (submitBtn.textContent || '').trim();
          addLog(`[skip]   clicking submit: "${st.slice(0, 60)}"`, 'ok');
          submitBtn.click();
          await new Promise((r) => setTimeout(r, 3000));
          return true;
        }

        addLog('[skip] Approach 1: no submit button found in dialog', 'warn');
        break;
      }
    }

    // Approach 2: submit skip form WITH gate_request[] appended
    for (const form of skipForms) {
      const action = form.getAttribute('action') || '';
      if (action.endsWith('/skip')) {
        addLog(`[skip] Approach 2: submitting form → ${action}`);
        const formData = new FormData(form);

        let addedGates = 0;
        if (!formData.has('gate_request[]')) {
          gateInputs.forEach((i) => {
            formData.append('gate_request[]', i.value);
            addedGates++;
          });
        }
        addLog(`[skip]   form fields: ${[...formData.keys()].join(', ')} (added ${addedGates} gate_request from DOM)`);

        if (!formData.has('gate_request[]')) {
          addLog(`[skip] Approach 2: no gate_request[] — skipping`, 'warn');
          continue;
        }

        const resp = await fetch(action, {
          method: 'POST',
          body: new URLSearchParams(formData as unknown as Record<string, string>),
          credentials: 'same-origin',
          redirect: 'follow',
        });
        addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
        if (resp.ok || resp.redirected) {
          addLog(`[skip] Approach 2: form submitted OK`, 'ok');
          return true;
        }
        addLog(`[skip] Approach 2: form submit failed (${resp.status})`, 'warn');
      }
    }

    // Approach 3: manual POST from CSRF in form + gate_request[]
    const csrfInput = skipForms.length > 0
      ? skipForms[0].querySelector<HTMLInputElement>('input[name="authenticity_token"]')
      : null;
    if (csrfInput && gateInputs.length > 0) {
      const csrf = csrfInput.value;
      addLog(`[skip] Approach 3: manual POST with CSRF from form + ${gateInputs.length} gate(s)`);

      const body = new URLSearchParams();
      body.append('authenticity_token', csrf);
      body.append('comment', 'Auto-skipped by Auto-Approve Deploy Gates');
      gateInputs.forEach((i) => body.append('gate_request[]', i.value));

      const skipUrl = `/${owner}/${repo}/environments/skip`;
      addLog(`[skip]   POST → ${skipUrl}`);
      const resp = await fetch(skipUrl, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        redirect: 'follow',
      });
      addLog(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
      if (resp.ok || resp.redirected) {
        addLog(`[skip] Approach 3: POST succeeded`, 'ok');
        return true;
      }
      addLog(`[skip] Approach 3: POST failed (${resp.status})`, 'warn');
    }

    addLog('[skip] All approaches exhausted — no skip controls found', 'warn');
    return false;
  } catch (e) {
    addLog(`[skip] Error: ${(e as Error).message}`, 'warn');
    return false;
  }
}
