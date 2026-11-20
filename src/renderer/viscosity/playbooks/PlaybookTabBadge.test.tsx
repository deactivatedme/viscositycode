import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { playbookBindingFromSaved } from "@/shared/viscosity/playbook";
import { PlaybookCompactLabel } from "./PlaybookTabBadge";

const review = playbookBindingFromSaved({
  id: "review",
  label: "Review",
  icon: "scan-eye",
  readOnly: true,
  instructions: "Review.",
});

describe("playbook marks", () => {
  it("renders nothing for none, cleared or a future-version binding", () => {
    const { container } = render(
      <>
        <PlaybookCompactLabel playbook={undefined} />
        <PlaybookCompactLabel playbook={null} />
        <PlaybookCompactLabel playbook={{ version: 2, id: "x" }} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the name and the read-only hint in compact surfaces", () => {
    render(<PlaybookCompactLabel playbook={review} />);
    expect(screen.getByText("Review").parentElement).toHaveAttribute(
      "title",
      "Playbook: Review · Asks the agent not to edit files",
    );
  });
});
