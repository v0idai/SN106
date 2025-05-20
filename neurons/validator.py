# The MIT License (MIT)
# Copyright © 2023 Yuma Rao
# TODO(developer): Set your name
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

# Bittensor
import bittensor as bt

# import base validator class which takes care of most of the boilerplate
from template.base.validator import BaseValidatorNeuron

# Bittensor Validator Template:
from template.validator import forward
import torch
from torch._C._te import Tensor # type: ignore
import string

# Define the version of the template module.

class Validator(BaseValidatorNeuron):
    """
    Your validator neuron class. You should use this class to define your validator's behavior. In particular, you should replace the forward function with your own logic.

    This class inherits from the BaseValidatorNeuron class, which in turn inherits from BaseNeuron. The BaseNeuron class takes care of routine tasks such as setting up wallet, subtensor, metagraph, logging directory, parsing config, etc. You can override any of the methods in BaseNeuron if you need to customize the behavior.

    This class provides reasonable default behavior for a validator such as keeping a moving average of the scores of the miners and using them to set weights at the end of each epoch. Additionally, the scores are reset for new hotkeys at the end of each epoch.
    """
    scores: Tensor
    
    def __init__(self, config=None):
        super(Validator, self).__init__(config=config)

        bt.logging.info("load_state()")
        self.load_state()

        # TODO(developer): Anything specific to your use case you can do here

    async def forward(self):
        """
        Validator forward pass. Consists of:
        - Generating the query
        - Querying the miners
        - Getting the responses
        - Rewarding the miners
        - Updating the scores
        """
        # TODO(developer): Rewrite this function based on your protocol definition.
        return await forward(self)

    def get_burn_uid(self) -> int:
        """
        Returns the UID of the subnet owner (the burn account) for this subnet.
        """
        # 1) Query the on-chain SubnetOwner hotkey
        sn_owner_hotkey = self.subtensor.query_subtensor(
            "SubnetOwnerHotkey",
            params=[self.config.netuid],
        )
        bt.logging.info(f"Subnet Owner Hotkey: {sn_owner_hotkey}")

        # 2) Convert that hotkey to its UID on this subnet
        burn_uid = self.subtensor.get_uid_for_hotkey_on_subnet(
            hotkey_ss58=sn_owner_hotkey,
            netuid=self.config.netuid,
        )
        bt.logging.info(f"Subnet Owner UID (burn): {burn_uid}")
        return burn_uid

    def set_burn_weights(self):
        """
        Assigns 100% of the weight to the burn UID by clamping negatives → 0,
        L1-normalizing [1.0] into a weight, and pushing on-chain.
        """
        __version__ = "1.8.7"
        __minimal_miner_version__ = "1.8.5"
        __minimal_validator_version__ = "1.8.7"

        version_split = __version__.split(".")
        __version_as_int__ = (100 * int(version_split[0])) + (10 * int(version_split[1])) + (1 * int(version_split[2]))
        # 1) fetch burn UID
        burn_uid = self.get_burn_uid()

        # 2) prepare a single-element score tensor
        scores = torch.tensor([1.0], dtype=torch.float32)
        scores[scores < 0] = 0

        # 3) normalize into a weight vector that sums to 1
        weights: torch.FloatTensor = torch.nn.functional.normalize(scores, p=1.0, dim=0).float()
        bt.logging.info(f"🔥 Burn-only weight: {weights.tolist()}")

        # 4) send to chain
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

        # Step 5: Perform queries to miners, scoring, and weight
        block_next_pog = 1
        block_next_sync_status = 1
        block_next_set_weights = self.current_block + 100
        block_next_hardware_info = 1
        block_next_miner_checking = 1

        time_next_pog = None
        time_next_sync_status = None
        time_next_set_weights = None
        time_next_hardware_info = None

        bt.logging.info("Starting validator loop.")
        while True:
            try:
                self.sync_local()

                if self.current_block not in self.blocks_done:

                    # Periodically update the weights on the Bittensor blockchain, ~ every 20 minutes
                    if self.current_block - self.last_updated_block > 100:
                        self.set_burn_weights()

                # bt.logging.info(
                #     (
                #         f"Block:{self.current_block} | "
                #         f"Stake:{self.metagraph.S[self.validator_subnet_uid]} | "
                #         f"Rank:{self.metagraph.R[self.validator_subnet_uid]} | "
                #         f"vTrust:{self.metagraph.validator_trust[self.validator_subnet_uid]} | "
                #         f"Emission:{self.metagraph.E[self.validator_subnet_uid]} | "
                #         f"next_pog: #{block_next_pog} ~ {time_next_pog} | "
                #         f"sync_status: #{block_next_sync_status} ~ {time_next_sync_status} | "
                #         f"set_weights: #{block_next_set_weights} ~ {time_next_set_weights} | "
                #         f"wandb_info: #{block_next_hardware_info} ~ {time_next_hardware_info} |"
                #     )
                # )
                await asyncio.sleep(1)

            # If we encounter an unexpected error, log it for debugging.
            except RuntimeError as e:
                bt.logging.error(e)
                # traceback.print_exc()

            # If the user interrupts the program, gracefully exit.
            except KeyboardInterrupt:
                self.db.close()
                bt.logging.success("Keyboard interrupt detected. Exiting validator.")
                exit()


def main():
    """
    Main function to run the neuron.

    This function initializes and runs the neuron. It handles the main loop, state management, and interaction
    with the Bittensor network.
    """
    validator = Validator()
    asyncio.run(validator.start())


if __name__ == "__main__":
    main()