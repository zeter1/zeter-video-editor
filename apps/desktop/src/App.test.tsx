// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';

test('renders the editor product name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Zeter Video Editor' })).toBeTruthy();
});
