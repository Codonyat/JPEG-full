import React from "react";

export function ConnectWallet({ connectWallet, message }) {
    return (
        <div className="clearfix">
            <button className="btn btn-primary float-end" type="button" onClick={connectWallet}>
                {!message && "Connect Wallet"}
                {message}
            </button>
        </div>
    );
}
