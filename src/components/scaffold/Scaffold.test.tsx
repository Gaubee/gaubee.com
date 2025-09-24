import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import ScaffoldExample from "./ScaffoldExample";

describe("Scaffold Components", () => {
  test("renders without crashing", () => {
    render(<ScaffoldExample />);
    expect(screen.getByText("Welcome to Scaffold Example")).toBeInTheDocument();
  });

  test("renders navigation items", () => {
    render(<ScaffoldExample />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
  });

  test("renders app bar", () => {
    render(<ScaffoldExample />);
    expect(screen.getByText("My App")).toBeInTheDocument();
  });
});
