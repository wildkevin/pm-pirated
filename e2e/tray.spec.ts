import { test } from '@playwright/test'
import { verifyWindowsTray } from './helpers/tray'

test('Windows close hides the window, reopening the exe restores the draft, and explicit quit exits', () => verifyWindowsTray())
