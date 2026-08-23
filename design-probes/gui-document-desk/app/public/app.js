const connection = document.querySelector("#connection");
const eventsElement = document.querySelector("#events");
const runsElement = document.querySelector("#runs");
const searchResult = document.querySelector("#search-result");

let eventCursor = Number(localStorage.getItem("document-desk-event-cursor") ?? "0");
const runs = new Map();

const request = async (path, options) => {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options?.headers },
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message ?? value.error ?? "request failed");
  return value;
};

const renderRuns = () => {
  runsElement.replaceChildren(...[...runs.values()].map(run => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${run.bindingId} · ${run.state} · ${run.runId}`;
    item.append(label);
    if (run.state === "pending" || run.state === "running") {
      const button = document.createElement("button");
      button.textContent = "Cancel";
      button.addEventListener("click", async () => {
        await request(`/api/runs/${encodeURIComponent(run.runId)}`, {
          method: "DELETE",
          body: JSON.stringify({ cancellationId: crypto.randomUUID() }),
        });
      });
      item.append(button);
    }
    return item;
  }));
};

const rememberRun = run => {
  runs.set(run.runId, run);
  renderRuns();
};

document.querySelector("#document-form").addEventListener("submit", async event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  rememberRun(await request("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      submissionId: crypto.randomUUID(),
      documentId: values.get("documentId"),
      revision: Number(values.get("revision")),
      text: values.get("text"),
    }),
  }));
});

document.querySelector("#search-form").addEventListener("submit", async event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  const run = await request("/api/search", {
    method: "POST",
    body: JSON.stringify({
      submissionId: crypto.randomUUID(),
      query: values.get("query"),
    }),
  });
  rememberRun(run);
});

const poll = async () => {
  try {
    for (const run of runs.values()) {
      if (run.state !== "pending" && run.state !== "running") continue;
      const next = await request(`/api/runs/${encodeURIComponent(run.runId)}`);
      rememberRun(next);
      if (next.bindingId === "search" && next.result) {
        searchResult.textContent = JSON.stringify(next.result.output, null, 2);
      }
    }

    const page = await request(`/api/events?after=${eventCursor}`);
    for (const event of page.events) {
      const item = document.createElement("li");
      item.textContent = `#${event.journalPosition} ${event.type} ${JSON.stringify(event.data)}`;
      eventsElement.prepend(item);
    }
    eventCursor = page.nextPosition;
    localStorage.setItem("document-desk-event-cursor", String(eventCursor));
    connection.textContent = "Connected";
  } catch (error) {
    connection.textContent = error instanceof Error ? error.message : "Disconnected";
  } finally {
    window.setTimeout(poll, 750);
  }
};

void poll();
