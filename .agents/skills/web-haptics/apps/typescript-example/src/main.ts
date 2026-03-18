import { WebHaptics } from "web-haptics";

const haptics = new WebHaptics();

const button = document.getElementById("trigger-btn")!;
button.addEventListener("click", () => haptics.trigger());
