// ViscosityCode: the stacked thread-row tag shows the whole machine name.
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Project } from "@/shared/contracts";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { FlatListProjectTag } from "./FlatListProjectTag";

const project = { id: "p1", name: "Home", location: { kind: "local" } } as unknown as Project;
const remote = {
  isRemote: true,
  serverName: "Vinnys-MacBook-Pro.local",
  status: "online",
} as const;

it("caps the machine name only in the inline tag; the stacked line shrinks it when it runs out", () => {
  const stacked = render(<FlatListProjectTag project={project} remote={remote} stacked />);
  const full = screen.getByText(remote.serverName);
  expect(full).toHaveClass("truncate", "min-w-0");
  expect(full.className).not.toMatch(/max-w-|shrink-0/);
  stacked.unmount();

  render(<FlatListProjectTag project={project} remote={remote} stacked={false} />);
  expect(screen.getByText(remote.serverName)).toHaveClass("truncate", "max-w-20", "shrink-0");
});
