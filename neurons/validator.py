# The MIT License (MIT)
# Copyright © 2023 Yuma Rao
# Copyright © 2023 <your name>

# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
# documentation files (the “Software”), to deal in the Software without restriction, including without limitation
# the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
# and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

# The above copyright notice and this permission notice shall be included in all copies or substantial portions of
# the Software.

# THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
# THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
# THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
# OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
# DEALINGS IN THE SOFTWARE.

import time
import asyncio
# Bittensor
import bittensor as bt

# import base validator class which takes care of most of the boilerplate
from template.base.validator import BaseValidatorNeuron

# Bittensor Validator Template:
from template.validator import forward
import torch
from torch._C._te import Tensor  # type: ignore
import string


class Validator(BaseValidatorNeuron):
    """
    Your validator neuron class.
    Inherits from BaseValidatorNeuron and implements validator-specific logic.
    """
    scores: Tensor
    
    def __init__(self, config=None):
        super(Validator, self).__init__(config=config)

        bt.logging.info("load_state()")
        self.load_state()

    async def forward(self):
        """
        Validator forward pass. Consists of:
        - Generating the query
        - Querying the miners
        - Getting the responses
        - Rewarding the miners
        - Updating the scores
        """
        return await forward(self)

    def get_burn_uid(self) -> int:
        """
        Returns the UID of the subnet owner (the burn account) for this subnet.
        """
        sn_owner_hotkey = self.subtensor.query_subtensor(
            "SubnetOwnerHotkey",
            params=[self.config.netuid],
        )
        bt.logging.info(f"Subnet Owner Hotkey: {sn_owner_hotkey}")

        burn_uid = self.subtensor.get_uid_for_hotkey_on_subnet(
            hotkey_ss58=sn_owner_hotkey,
            netuid=self.config.netuid,
        )
        bt.logging.info(f"Subnet Owner UID (burn): {burn_uid}")
        return burn_uid

    def set_burn_weights(self):
        """
        Assigns 100% of the weight to the burn UID and pushes on-chain.
        """
        __version__ = "1.8.7"
        version_split = __version__.split(".")
        __version_as_int__ = (
            100 * int(version_split[0])
            + 10 * int(version_split[1])
            + 1 * int(version_split[2])
        )

        burn_uid = self.get_burn_uid()
        scores = torch.tensor([1.0], dtype=torch.float32)
        scores[scores < 0] = 0
        weights = torch.nn.functional.normalize(scores, p=1.0, dim=0).float()
        bt.logging.info(f"🔥 Burn-only weight: {weights.tolist()}")

        result = self.subtensor.set_weights(
            netuid=self.config.netuid,
            wallet=self.wallet,
            uids=[burn_uid],
            weights=weights,
            version_key=__version_as_int__,
            wait_for_inclusion=False,
        )

        if isinstance(result, tuple) and result[0]:
            bt.logging.success("✅ Successfully set burn weights.")
        else:
            bt.logging.error(f"❌ Failed to set burn weights: {result}")

    async def start(self):
        """The Main Validation Loop"""
        self.loop = asyncio.get_running_loop()
         # Initialize time trackers
        last_burn_weights_time = 0  # epoch time in seconds
        burn_weights_interval = 20 * 60  # 20 minutes in seconds

        bt.logging.info("Starting validator loop.")
        while True:
            try:
                self.sync()
                
                current_time = time.time()
                if current_time - last_burn_weights_time >= burn_weights_interval:
                    self.set_burn_weights()
                    last_burn_weights_time = current_time

                await asyncio.sleep(1)

            except RuntimeError as e:
                bt.logging.error(e)

            except KeyboardInterrupt:
                self.db.close()
                bt.logging.success("Keyboard interrupt detected. Exiting validator.")
                exit()


def main():
    """
    Main function to run the neuron.
    """
    validator = Validator()
    asyncio.run(validator.start())


if __name__ == "__main__":
    main()
