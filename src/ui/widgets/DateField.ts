import { TextComponent } from "obsidian";
import { isIso, todayIso } from "../../util/DateUtil";

export class DateField {
  public input: HTMLInputElement;
  constructor(
    container: HTMLElement,
    defaultValue: string | null,
    private onChange: (iso: string) => void,
  ) {
    const text = new TextComponent(container);
    text.setValue(defaultValue ?? todayIso());
    text.setPlaceholder("YYYY-MM-DD");
    this.input = text.inputEl;
    this.input.type = "date";
    this.input.addEventListener("change", () => {
      const v = this.input.value;
      if (!isIso(v)) return;
      this.onChange(v);
    });
  }
}
