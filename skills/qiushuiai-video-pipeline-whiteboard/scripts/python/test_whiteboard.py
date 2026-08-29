import unittest
import numpy as np
from whiteboard import prepare_hand


class HandMaskTest(unittest.TestCase):
    def test_pixels_outside_mask_are_zero(self):
        hand, mask, _ = prepare_hand()
        self.assertTrue(np.all(hand[mask == 0] == 0))


if __name__ == "__main__":
    unittest.main()
