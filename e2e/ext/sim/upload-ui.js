// Simulates an ATS upload field for the attach checks: a hidden file input
// whose chosen file the page shows by name, as Greenhouse's and Lever's do.
// window.sim records what the page saw: files chosen, drops, form submissions.
window.sim = { changes: 0, drops: 0, submitted: 0 };
document.addEventListener("submit", (event) => {
  window.sim.submitted++;
  event.preventDefault();
});
function showFiles(list, files) {
  list.replaceChildren(...[...files].map((file) => Object.assign(document.createElement("li"), { textContent: file.name })));
}
function wire(root) {
  for (const input of root.querySelectorAll("input[type=file]")) {
    const list = input.closest("[data-upload]").querySelector(".files");
    input.addEventListener("change", () => {
      window.sim.changes++;
      showFiles(list, input.files);
      if (input.form?.dataset.autosubmit === "on") input.form.requestSubmit();
    });
  }
}
wire(document);
// Workday-style: a drop zone that adds dropped files to its list (and to the hidden input).
for (const zone of document.querySelectorAll("[data-automation-id=file-upload-drop-zone]")) {
  zone.addEventListener("dragover", (event) => event.preventDefault());
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    window.sim.drops++;
    const list = zone.querySelector(".files");
    for (const file of event.dataTransfer.files) list.append(Object.assign(document.createElement("li"), { textContent: file.name }));
  });
}
// Another extension (Simplify) attached a resume before ours.
for (const input of document.querySelectorAll("input[data-preattached]")) {
  const transfer = new DataTransfer();
  transfer.items.add(new File(["%PDF-1.4 simplify"], input.dataset.preattached, { type: "application/pdf" }));
  input.files = transfer.files;
  showFiles(input.closest("[data-upload]").querySelector(".files"), input.files);
}
// The form is only put in the page once Apply is clicked (as single-page apps do).
document.querySelector("#show-form")?.addEventListener("click", () => {
  const form = document.querySelector("#late-form").content.cloneNode(true);
  document.querySelector("main").append(form);
  wire(document.querySelector("#late"));
});
