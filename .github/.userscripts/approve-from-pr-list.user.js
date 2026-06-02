// ==UserScript==
// @name         Approve PR from the list view
// @namespace    readily.compliance
// @version      1.0.0
// @description  Adds an "Approve" button to each row of GitHub's PR list, so a compliance review can be submitted without opening the PR. Approves as YOU (uses your own token), so it counts as a real GitHub review and triggers the review-status pill workflow.
// @match        https://github.com/*/*/pulls*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// ==/UserScript==

(function () {
  "use strict";

  const TOKEN_KEY = "gh_pat";
  const BTN_FLAG = "data-approve-btn-added";

  // ---- Token management -----------------------------------------------------
  // The token is YOUR personal access token. The approval is attributed to you,
  // which is what compliance requires. Needs "Pull requests: Read and write"
  // (fine-grained PAT) or the `repo` scope (classic PAT).

  function getToken() {
    return GM_getValue(TOKEN_KEY, "");
  }

  function promptForToken() {
    const existing = getToken();
    const value = window.prompt(
      "Paste a GitHub token with Pull-requests write access.\n" +
        "Fine-grained: Pull requests → Read and write.\n" +
        "Classic: the `repo` scope.\n\n" +
        "Stored only in this userscript's storage on this machine.",
      existing
    );
    if (value !== null) {
      const trimmed = value.trim();
      if (trimmed) {
        GM_setValue(TOKEN_KEY, trimmed);
      } else {
        GM_deleteValue(TOKEN_KEY);
      }
    }
    return getToken();
  }

  GM_registerMenuCommand("Set / update GitHub token", promptForToken);
  GM_registerMenuCommand("Clear GitHub token", () => GM_deleteValue(TOKEN_KEY));

  // ---- API call -------------------------------------------------------------

  function submitApproval(owner, repo, number, token) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/reviews`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        data: JSON.stringify({ event: "APPROVE" }),
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve();
          } else {
            let message = `HTTP ${res.status}`;
            try {
              const body = JSON.parse(res.responseText);
              if (body && body.message) message = body.message;
            } catch (_) {
              /* keep the HTTP status */
            }
            reject(new Error(message));
          }
        },
        onerror: () => reject(new Error("network error")),
      });
    });
  }

  // ---- Button wiring --------------------------------------------------------

  // The PR title link is stable: it carries data-hovercard-type="pull_request"
  // and an href like /owner/repo/pull/1234. We derive owner/repo/number from it
  // rather than depending on the surrounding row markup.
  const HREF_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

  function setStatus(btn, label, color) {
    btn.textContent = label;
    btn.style.color = color || "";
  }

  async function onClick(evt, owner, repo, number, btn) {
    evt.preventDefault();
    evt.stopPropagation();

    let token = getToken();
    if (!token) token = promptForToken();
    if (!token) return;

    const original = btn.textContent;
    btn.disabled = true;
    setStatus(btn, "Approving…", "");
    try {
      await submitApproval(owner, repo, number, token);
      setStatus(btn, "✓ Approved", "#1a7f37");
    } catch (err) {
      setStatus(btn, "✗ Failed", "#cf222e");
      btn.title = String(err && err.message ? err.message : err);
      btn.disabled = false;
      // Restore the original label shortly so it can be retried.
      setTimeout(() => {
        setStatus(btn, original, "");
        btn.title = "Approve this PR as you";
      }, 4000);
    }
  }

  function makeButton(owner, repo, number) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Approve";
    btn.title = "Approve this PR as you";
    btn.style.cssText =
      "margin-left:8px;padding:0 8px;font-size:12px;line-height:20px;" +
      "border:1px solid var(--borderColor-default,#d0d7de);border-radius:6px;" +
      "background:var(--bgColor-muted,#f6f8fa);cursor:pointer;vertical-align:middle;";
    btn.addEventListener("click", (e) => onClick(e, owner, repo, number, btn));
    return btn;
  }

  function inject() {
    const links = document.querySelectorAll(
      'a[data-hovercard-type="pull_request"]'
    );
    for (const link of links) {
      if (link.getAttribute(BTN_FLAG)) continue;
      const href = link.getAttribute("href") || "";
      const m = href.match(HREF_RE);
      if (!m) continue;
      link.setAttribute(BTN_FLAG, "1");
      const [, owner, repo, number] = m;
      link.insertAdjacentElement("afterend", makeButton(owner, repo, number));
    }
  }

  // Initial pass + re-inject across GitHub's client-side (Turbo) navigation
  // and incremental list updates
  inject();
  const observer = new MutationObserver(() => inject());
  observer.observe(document.body, { childList: true, subtree: true });
})();
