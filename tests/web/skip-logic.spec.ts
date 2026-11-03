import { test, expect } from '@playwright/test';

test('hobby follow-up is visible only when answer is Yes', async ({ page }) => {
  await page.goto('/survey/hobbies');

  const answer = page.getByLabel('Do you have a hobby?');
  const hobby = page.getByLabel('What is your hobby?');

  await expect(hobby).toBeHidden();
  await answer.selectOption('Yes');
  await expect(hobby).toBeVisible();

  await hobby.fill('Drawing');
  await answer.selectOption('No');
  await expect(hobby).toBeHidden();
  await expect(hobby).toHaveValue('');
});
