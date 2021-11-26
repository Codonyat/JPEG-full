import React from "react";

// We'll use ethers to interact with the Ethereum network and our contract
import { ethers } from "ethers";

// We import the contract's artifacts and address here, as we are going to be
// using them with ethers
import JPEGminerArtifact from "../contracts/JPEGminer.json";
import contractAddress from "../contracts/contractData.json";

// All the logic of this dapp is contained in the Dapp component.
// These other components are just presentational ones: they don't have any
// logic. They just render HTML.
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Mine } from "./Mine";
import { TransactionErrorMessage } from "./TransactionErrorMessage";
import { WaitingForTransactionMessage } from "./WaitingForTransactionMessage";

// const gwei = ethers.BigNumber.from(10).pow(9);

// This is the Hardhat Network id, you might change it in the hardhat.config.js
// Here's a list of network ids https://docs.metamask.io/guide/ethereum-provider.html#properties
// to use when deploying to other networks.
const HARDHAT_NETWORK_ID = "31337";

// This is an error code that indicates that the user canceled a transaction
const ERROR_CODE_TX_REJECTED_BY_USER = 4001;

// This component is in charge of doing these things:
//   1. It connects to the user's wallet
//   2. Initializes ethers and the JPEGminer contract
//   3. Polls the user state in JPEGminer
//   4. Mines NFT
//   5. Renders the whole application
//
export class DappMiner extends React.Component {
    constructor(props) {
        super(props);

        // We store multiple things in Dapp's state.
        // You don't need to follow this pattern, but it's an useful example.
        this.initialState = {
            // Miner's data
            canMine: undefined,
            // Mining data
            imageScans: undefined,
            nextScan: undefined,
            // Gas parameters
            maxFeePerGas: undefined,
            maxPriorityFeePerGas: undefined,
            // The user's address
            selectedAddress: undefined,
            // The ID about transactions being sent, and any possible error with them
            txBeingSent: undefined,
            transactionError: undefined,
            networkError: undefined
        };

        this.state = this.initialState;
    }

    render() {
        // Ethereum wallets inject the window.ethereum object. If it hasn't been
        // injected, we instruct the user to install MetaMask.
        if (window.ethereum === undefined) {
            return <NoWalletDetected />;
        }

        // If everything is loaded, we render the application.
        return (
            <div className="container">
                <ConnectWallet
                    connectWallet={() => this._connectWallet()}
                    selectedAddress={this.state.selectedAddress}
                />

                <hr />

                <div className="row">
                    <div className="col-12">
                        {/* 
                            Sending a transaction isn't an immidiate action. You have to wait
                            for it to be mined.
                            If we are waiting for one, we show a message here.
                        */}
                        {this.state.txBeingSent && <WaitingForTransactionMessage txHash={this.state.txBeingSent} />}

                        {/* 
                            Sending a transaction can fail in multiple ways. 
                            If that happened, we show a message here.
                        */}
                        {this.state.transactionError && (
                            <TransactionErrorMessage
                                message={this._getRpcErrorMessage(this.state.transactionError)}
                                dismiss={() => this._dismissTransactionError()}
                            />
                        )}
                    </div>
                </div>

                <div className="row">
                    <div className="col-12">
                        {/*
                            If the user has no tokens, we don't show the Tranfer form
                        */}
                        {!this.state.canMine && <p>You cannot mine if you own 1 or more already.</p>}

                        {/*
                            This component displays a form that the user can use to send a 
                            transaction and transfer some tokens.
                            The component doesn't have logic, it just calls the transferTokens
                            callback.
                        */}
                        {this.state.canMine && <Mine mineFunc={(amount) => this._mine(amount)} />}
                    </div>
                </div>
            </div>
        );
    }

    componentWillUnmount() {
        // We poll the user's state
        // gets unmounted
        this._stopPollingData();
    }

    async _connectWallet() {
        // This method is run when the user clicks the Connect. It connects the
        // dapp to the user's wallet, and initializes it.

        // To connect to the user's wallet, we have to run this method.
        // It returns a promise that will resolve to the user's address.
        const [selectedAddress] = await window.ethereum.request({ method: "eth_requestAccounts" });

        // Once we have the address, we can initialize the application.

        // First we check the network
        if (!this._checkNetwork()) {
            return;
        }

        this._initialize(selectedAddress);

        // We reinitialize it whenever the user changes their account.
        window.ethereum.on("accountsChanged", ([newAddress]) => {
            this._stopPollingData();
            // `accountsChanged` event can be triggered with an undefined newAddress.
            // This happens when the user removes the Dapp from the "Connected
            // list of sites allowed access to your addresses" (Metamask > Settings > Connections)
            // To avoid errors, we reset the dapp state
            if (newAddress === undefined) {
                return this._resetState();
            }

            this._initialize(newAddress);
        });

        // We reset the dapp state if the network is changed
        window.ethereum.on("chainChanged ", ([chainId]) => {
            this._stopPollingData();
            this._resetState();
        });
    }

    _initialize(userAddress) {
        // This method initializes the dapp

        // We first store the user's address in the component's state
        this.setState({
            selectedAddress: userAddress
        });

        // Then, we initialize ethers, fetch user's state

        // Fetching the user's data
        this._intializeEthers();
        this._intializeData();
        this._startPollingData();
    }

    async _intializeEthers() {
        // We first initialize ethers by creating a provider using window.ethereum
        this._provider = new ethers.providers.Web3Provider(window.ethereum);

        // When, we initialize the contract using that provider and the JPEG miner
        // artifact. You can do this same thing with your contracts.
        this._jpegMiner = new ethers.Contract(
            contractAddress.JPEGminer,
            JPEGminerArtifact.abi,
            this._provider.getSigner(0)
        );
    }

    async _intializeData() {
        this.setState({
            imageScans: contractAddress.imageScans
        });
    }

    // The next two methods are needed to start and stop polling data.
    _startPollingData() {
        this._pollDataInterval = setInterval(() => this._updateMinerStatus(), 1000);

        this._pollGasInterval = setInterval(() => this._updateGasParams(), 12000);

        // We run it once immediately so we don't have to wait for it
        this._updateMinerStatus();
        this._updateGasParams();
    }

    _stopPollingData() {
        clearInterval(this._pollDataInterval);
        this._pollDataInterval = undefined;
        clearInterval(this._pollGasInterval);
        this._pollGasInterval = undefined;
    }

    async _updateMinerStatus() {
        // HANDLE ERRORS SUCH AS INFURA DOES NOT REPLY!!
        const Ncopies = await this._jpegMiner.balanceOf(this.state.selectedAddress);
        const nextScan = await this._jpegMiner.totalSupply();
        this.setState({ canMine: Ncopies.toNumber() === 0, nextScan: nextScan.toNumber() });
    }

    async _updateGasParams() {
        // DO SMTH TO DEAL WITH FAILED REQUESTS
        const resp = await fetch("https://api.gasprice.io/v1/estimates");
        const {
            result: {
                fast: { feeCap, maxPriorityFee }
            }
        } = await resp.json();

        this.setState({
            maxFeePerGas: ethers.utils.parseUnits(feeCap.toFixed(9).toString(), "gwei"),
            maxPriorityFeePerGas: ethers.utils.parseUnits(maxPriorityFee.toFixed(9).toString(), "gwei")
        });
    }

    // This method sends an ethereum transaction to transfer tokens.
    // While this action is specific to this application, it illustrates how to
    // send a transaction.

    /** AMOUNT IS ALWAYS PASSED BY THE USER, BUT IT COULD BE PREFILLD BY THE FRONTEND.
     * TAKE CARE OF THE CASE WHERE AMOUNT IS TOO LARGE
     *  */
    async _mine(amount) {
        // Sending a transaction is a complex operation:
        //   - The user can reject it
        //   - It can fail before reaching the ethereum network (i.e. if the user
        //     doesn't have ETH for paying for the tx's gas)
        //   - It has to be mined, so it isn't immediately confirmed.
        //     Note that some testing networks, like Hardhat Network, do mine
        //     transactions immediately, but your dapp should be prepared for
        //     other networks.
        //   - It can fail once mined.
        //
        // This method handles all of those things, so keep reading to learn how to
        // do it.

        try {
            // If a transaction fails, we save that error in the component's state.
            // We only save one such error, so before sending a second transaction, we
            // clear it.
            this._dismissTransactionError();

            // const gasPrice = await this._provider.getGasPrice();

            // We send the transaction, and save its hash in the Dapp's state. This
            // way we can indicate that we are waiting for it to be mined.
            const expectedGasTx = ethers.BigNumber.from(70707).mul(this.state.nextScan).add(3000000);
            const tx = await this._jpegMiner.mine(this.state.imageScans[this.state.nextScan], {
                value: ethers.constants.WeiPerEther.mul(amount),
                maxFeePerGas: this.state.maxFeePerGas,
                maxPriorityFeePerGas: this.state.maxPriorityFeePerGas,
                gasLimit: expectedGasTx.mul(11).div(10)
            });
            this.setState({ txBeingSent: tx.hash });

            // We use .wait() to wait for the transaction to be mined. This method
            // returns the transaction's receipt.
            const receipt = await tx.wait();

            // The receipt, contains a status flag, which is 0 to indicate an error.
            if (receipt.status === 0) {
                // We can't know the exact error that made the transaction fail when it
                // was mined, so we throw this generic one.
                throw new Error("Transaction failed");
            }

            // If we got here, the transaction was successful, so you may want to
            // update your state.
            await this._updateMinerStatus();
        } catch (error) {
            // We check the error code to see if this error was produced because the
            // user rejected a tx. If that's the case, we do nothing.
            if (error.code === ERROR_CODE_TX_REJECTED_BY_USER) {
                return;
            }

            // Other errors are logged and stored in the Dapp's state. This is used to
            // show them to the user, and for debugging.
            console.error(error);
            this.setState({ transactionError: error });
        } finally {
            // If we leave the try/catch, we aren't sending a tx anymore, so we clear
            // this part of the state.
            this.setState({ txBeingSent: undefined });
        }
    }

    // This method just clears part of the state.
    _dismissTransactionError() {
        this.setState({ transactionError: undefined });
    }

    // This method just clears part of the state.
    _dismissNetworkError() {
        this.setState({ networkError: undefined });
    }

    // This is an utility method that turns an RPC error into a human readable
    // message.
    _getRpcErrorMessage(error) {
        if (error.data) {
            return error.data.message;
        }

        return error.message;
    }

    // This method resets the state
    _resetState() {
        this.setState(this.initialState);
    }

    // This method checks if Metamask selected network is Localhost:8545
    _checkNetwork() {
        if (window.ethereum.networkVersion === HARDHAT_NETWORK_ID) {
            return true;
        }

        this.setState({
            networkError: "Please connect Metamask to Localhost:8545"
        });

        return false;
    }
}
