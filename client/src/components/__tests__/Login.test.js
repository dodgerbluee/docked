/**
 * Component tests for Login component
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import Login from "../Login";
import axios from "axios";

// Mock axios
jest.mock("axios");

describe("Login Component", () => {
  const mockOnLogin = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("renders login form", () => {
    render(<Login onLogin={mockOnLogin} />);

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /login/i })).toBeInTheDocument();
  });

  it("shows error message on login failure", async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        data: { error: "Invalid credentials" },
      },
    });

    render(<Login onLogin={mockOnLogin} />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole("button", { name: /login/i });

    fireEvent.change(usernameInput, { target: { value: "admin" } });
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  it("calls onLogin on successful login", async () => {
    const mockResponse = {
      data: {
        success: true,
        token: "test-token",
        refreshToken: "test-refresh",
        username: "admin",
        role: "Administrator",
      },
    };

    axios.post.mockResolvedValueOnce(mockResponse);

    render(<Login onLogin={mockOnLogin} />);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole("button", { name: /login/i });

    fireEvent.change(usernameInput, { target: { value: "admin" } });
    fireEvent.change(passwordInput, { target: { value: "admin" } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnLogin).toHaveBeenCalledWith(
        "test-token",
        "admin",
        expect.any(Boolean),
        "Administrator"
      );
    });
  });
});
